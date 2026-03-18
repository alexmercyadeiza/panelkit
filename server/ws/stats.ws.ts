// ─── WebSocket Stats Streaming ───────────────────────────────────────────────
//
// Real-time server and app metrics streaming over WebSocket.
// Broadcasts stats at a 1-second interval to connected clients.
//

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StatsMessage {
  type: "stats";
  scope: "server" | "app";
  appId?: string;
  data: {
    cpuPercent?: number | null;
    memoryUsedMb?: number | null;
    memoryTotalMb?: number | null;
    networkRxBytes?: number | null;
    networkTxBytes?: number | null;
    requestCount?: number | null;
  };
  timestamp: string;
}

export interface StatsSubscribeMessage {
  type: "subscribe";
  scope: "server" | "app";
  appId?: string;
}

export interface StatsUnsubscribeMessage {
  type: "unsubscribe";
  scope: "server" | "app";
  appId?: string;
}

export type StatsClientMessage = StatsSubscribeMessage | StatsUnsubscribeMessage;

export interface StatsServerMessage {
  type: "stats" | "subscribed" | "unsubscribed" | "error";
  scope?: "server" | "app";
  appId?: string;
  data?: StatsMessage["data"];
  message?: string;
  timestamp?: string;
}

/**
 * Minimal WebSocket interface compatible with Bun's ServerWebSocket.
 */
export interface WSClient {
  send(data: string): void;
  readyState?: number;
}

// ─── Subscription Key ────────────────────────────────────────────────────────

function subscriptionKey(scope: "server" | "app", appId?: string): string {
  return scope === "app" && appId ? `app:${appId}` : "server";
}

// ─── Connection Manager ──────────────────────────────────────────────────────

/**
 * Manages WebSocket connections for real-time stats streaming.
 */
export class StatsConnectionManager {
  /** Map from subscription key to set of connected clients */
  private _subscriptions = new Map<string, Set<WSClient>>();

  /** Map from client to set of subscription keys (for cleanup) */
  private _clientKeys = new Map<WSClient, Set<string>>();

  /** Interval handle for periodic stats broadcast */
  private _intervalHandle: ReturnType<typeof setInterval> | null = null;

  /** Broadcast callback — set by the consumer to provide stats data */
  private _broadcastCallback: (() => Promise<void>) | null = null;

  /**
   * Subscribe a client to stats for a scope.
   */
  subscribe(client: WSClient, scope: "server" | "app", appId?: string): void {
    const key = subscriptionKey(scope, appId);

    let clients = this._subscriptions.get(key);
    if (!clients) {
      clients = new Set();
      this._subscriptions.set(key, clients);
    }
    clients.add(client);

    let keys = this._clientKeys.get(client);
    if (!keys) {
      keys = new Set();
      this._clientKeys.set(client, keys);
    }
    keys.add(key);

    safeSend(client, {
      type: "subscribed",
      scope,
      appId,
      message: `Subscribed to ${scope} stats${appId ? ` for app ${appId}` : ""}`,
    });

    // Start interval if this is the first subscriber
    this._maybeStartInterval();
  }

  /**
   * Unsubscribe a client from a scope.
   */
  unsubscribe(client: WSClient, scope: "server" | "app", appId?: string): void {
    const key = subscriptionKey(scope, appId);

    const clients = this._subscriptions.get(key);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        this._subscriptions.delete(key);
      }
    }

    const keys = this._clientKeys.get(client);
    if (keys) {
      keys.delete(key);
      if (keys.size === 0) {
        this._clientKeys.delete(client);
      }
    }

    safeSend(client, {
      type: "unsubscribed",
      scope,
      appId,
      message: `Unsubscribed from ${scope} stats`,
    });

    // Stop interval if no subscribers remain
    this._maybeStopInterval();
  }

  /**
   * Remove a client from all subscriptions (on disconnect).
   */
  removeClient(client: WSClient): void {
    const keys = this._clientKeys.get(client);
    if (keys) {
      for (const key of keys) {
        const clients = this._subscriptions.get(key);
        if (clients) {
          clients.delete(client);
          if (clients.size === 0) {
            this._subscriptions.delete(key);
          }
        }
      }
      this._clientKeys.delete(client);
    }

    this._maybeStopInterval();
  }

  /**
   * Broadcast a stats message to all clients subscribed to the given scope.
   */
  broadcast(message: StatsMessage): void {
    const key = subscriptionKey(message.scope, message.appId);
    const clients = this._subscriptions.get(key);
    if (!clients || clients.size === 0) return;

    const payload: StatsServerMessage = {
      type: "stats",
      scope: message.scope,
      appId: message.appId,
      data: message.data,
      timestamp: message.timestamp,
    };

    const json = JSON.stringify(payload);

    for (const client of clients) {
      try {
        if (client.readyState !== undefined && client.readyState !== 1) {
          this.removeClient(client);
          continue;
        }
        client.send(json);
      } catch {
        this.removeClient(client);
      }
    }
  }

  /**
   * Handle an incoming message from a client.
   */
  handleMessage(client: WSClient, raw: string): void {
    try {
      const msg = JSON.parse(raw) as StatsClientMessage;

      switch (msg.type) {
        case "subscribe":
          if (!msg.scope) {
            safeSend(client, { type: "error", message: "scope is required" });
            return;
          }
          if (msg.scope === "app" && !msg.appId) {
            safeSend(client, {
              type: "error",
              message: "appId is required for app scope",
            });
            return;
          }
          this.subscribe(client, msg.scope, msg.appId);
          break;

        case "unsubscribe":
          if (msg.scope) {
            this.unsubscribe(client, msg.scope, msg.appId);
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
   * Set the callback that is invoked every interval tick
   * to collect and broadcast stats.
   */
  setBroadcastCallback(callback: () => Promise<void>): void {
    this._broadcastCallback = callback;
  }

  /**
   * Get the number of clients subscribed to a specific scope.
   */
  getSubscriberCount(scope: "server" | "app", appId?: string): number {
    const key = subscriptionKey(scope, appId);
    return this._subscriptions.get(key)?.size ?? 0;
  }

  /**
   * Get the total number of connected clients.
   */
  getTotalClients(): number {
    return this._clientKeys.size;
  }

  /**
   * Check if the broadcast interval is running.
   */
  isRunning(): boolean {
    return this._intervalHandle !== null;
  }

  /**
   * Stop the broadcast interval.
   */
  stop(): void {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private _maybeStartInterval(): void {
    if (this._intervalHandle) return;
    if (this._clientKeys.size === 0) return;

    this._intervalHandle = setInterval(async () => {
      if (this._broadcastCallback) {
        try {
          await this._broadcastCallback();
        } catch {
          // Don't crash the interval on errors
        }
      }
    }, 1000);
  }

  private _maybeStopInterval(): void {
    if (this._clientKeys.size === 0 && this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeSend(client: WSClient, data: StatsServerMessage): void {
  try {
    client.send(JSON.stringify(data));
  } catch {
    // Client disconnected
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const statsConnectionManager = new StatsConnectionManager();
