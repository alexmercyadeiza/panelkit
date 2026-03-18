// ─── WebSocket Log Streaming Infrastructure ──────────────────────────────────
//
// Provides connection management and fan-out broadcasting for real-time
// log streaming. Designed to work with Bun's native WebSocket API.
//

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogMessage {
  type: "log";
  appId: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  source?: string;
}

export interface LogSubscribeMessage {
  type: "subscribe";
  appId: string;
}

export interface LogUnsubscribeMessage {
  type: "unsubscribe";
  appId: string;
}

export type LogClientMessage = LogSubscribeMessage | LogUnsubscribeMessage;

export interface LogServerMessage {
  type: "log" | "subscribed" | "unsubscribed" | "error";
  appId?: string;
  level?: LogLevel;
  message?: string;
  timestamp?: string;
  source?: string;
}

/**
 * Minimal WebSocket interface compatible with Bun's ServerWebSocket
 * and standard WebSocket for testing.
 */
export interface WSClient {
  send(data: string): void;
  readyState?: number;
}

// ─── Connection Manager ──────────────────────────────────────────────────────

/**
 * Manages WebSocket connections for log streaming.
 * Tracks which clients are subscribed to which app's logs.
 */
export class LogConnectionManager {
  /** Map from appId to set of connected clients */
  private _subscriptions = new Map<string, Set<WSClient>>();

  /** Map from client to set of subscribed appIds (for cleanup) */
  private _clientApps = new Map<WSClient, Set<string>>();

  /**
   * Subscribe a client to an app's log stream.
   */
  subscribe(client: WSClient, appId: string): void {
    // Add to subscriptions
    let clients = this._subscriptions.get(appId);
    if (!clients) {
      clients = new Set();
      this._subscriptions.set(appId, clients);
    }
    clients.add(client);

    // Track reverse mapping for cleanup
    let apps = this._clientApps.get(client);
    if (!apps) {
      apps = new Set();
      this._clientApps.set(client, apps);
    }
    apps.add(appId);

    // Confirm subscription
    safeSend(client, {
      type: "subscribed",
      appId,
      message: `Subscribed to logs for app ${appId}`,
    });
  }

  /**
   * Unsubscribe a client from an app's log stream.
   */
  unsubscribe(client: WSClient, appId: string): void {
    const clients = this._subscriptions.get(appId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        this._subscriptions.delete(appId);
      }
    }

    const apps = this._clientApps.get(client);
    if (apps) {
      apps.delete(appId);
      if (apps.size === 0) {
        this._clientApps.delete(client);
      }
    }

    safeSend(client, {
      type: "unsubscribed",
      appId,
      message: `Unsubscribed from logs for app ${appId}`,
    });
  }

  /**
   * Remove a client from all subscriptions (on disconnect).
   */
  removeClient(client: WSClient): void {
    const apps = this._clientApps.get(client);
    if (apps) {
      for (const appId of apps) {
        const clients = this._subscriptions.get(appId);
        if (clients) {
          clients.delete(client);
          if (clients.size === 0) {
            this._subscriptions.delete(appId);
          }
        }
      }
      this._clientApps.delete(client);
    }
  }

  /**
   * Broadcast a log message to all clients subscribed to the given app.
   */
  broadcast(appId: string, message: LogMessage): void {
    const clients = this._subscriptions.get(appId);
    if (!clients || clients.size === 0) return;

    const payload: LogServerMessage = {
      type: "log",
      appId: message.appId,
      level: message.level,
      message: message.message,
      timestamp: message.timestamp,
      source: message.source,
    };

    const json = JSON.stringify(payload);

    for (const client of clients) {
      try {
        // Skip clients that are not in OPEN state
        if (client.readyState !== undefined && client.readyState !== 1) {
          this.removeClient(client);
          continue;
        }
        client.send(json);
      } catch {
        // Client disconnected — clean up
        this.removeClient(client);
      }
    }
  }

  /**
   * Handle an incoming message from a client.
   */
  handleMessage(client: WSClient, raw: string): void {
    try {
      const msg = JSON.parse(raw) as LogClientMessage;

      switch (msg.type) {
        case "subscribe":
          if (msg.appId) {
            this.subscribe(client, msg.appId);
          } else {
            safeSend(client, { type: "error", message: "appId is required" });
          }
          break;

        case "unsubscribe":
          if (msg.appId) {
            this.unsubscribe(client, msg.appId);
          }
          break;

        default:
          safeSend(client, {
            type: "error",
            message: `Unknown message type: ${(msg as { type: string }).type}`,
          });
      }
    } catch {
      safeSend(client, { type: "error", message: "Invalid JSON message" });
    }
  }

  /**
   * Get the number of clients subscribed to a specific app.
   */
  getSubscriberCount(appId: string): number {
    return this._subscriptions.get(appId)?.size ?? 0;
  }

  /**
   * Get the total number of connected clients.
   */
  getTotalClients(): number {
    return this._clientApps.size;
  }

  /**
   * Get all app IDs that have active subscribers.
   */
  getActiveApps(): string[] {
    return [...this._subscriptions.keys()];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeSend(client: WSClient, data: LogServerMessage): void {
  try {
    client.send(JSON.stringify(data));
  } catch {
    // Client disconnected
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const logConnectionManager = new LogConnectionManager();
