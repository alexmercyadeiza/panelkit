import { getConfig } from "../config";

export interface CaddyRoute {
  id: string;
  domain: string;
  upstream: string; // e.g., "localhost:4001"
}

export class CaddyError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "CaddyError";
  }
}

async function caddyRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const baseUrl = getConfig().CADDY_ADMIN_URL;
  const url = `${baseUrl}${path}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (response.status === 503 && attempt < 2) {
        // Caddy is reloading, retry with backoff
        await new Promise((r) =>
          setTimeout(r, 1000 * Math.pow(2, attempt))
        );
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new CaddyError(
          `Caddy API error: ${response.status} ${response.statusText} - ${body}`,
          response.status
        );
      }

      return response;
    } catch (error) {
      if (error instanceof CaddyError) throw error;
      lastError = error as Error;
      if (attempt < 2) {
        await new Promise((r) =>
          setTimeout(r, 1000 * Math.pow(2, attempt))
        );
        continue;
      }
    }
  }

  throw new CaddyError(
    `Cannot connect to Caddy at ${baseUrl}: ${lastError?.message || "unknown error"}`,
    503
  );
}

export async function addRoute(route: CaddyRoute): Promise<void> {
  const routeConfig = {
    "@id": route.id,
    match: [{ host: [route.domain] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: route.upstream }],
      },
    ],
    terminal: true,
  };

  await caddyRequest("/config/apps/http/servers/srv0/routes", {
    method: "POST",
    body: JSON.stringify(routeConfig),
  });
}

export async function removeRoute(routeId: string): Promise<void> {
  await caddyRequest(`/id/${routeId}`, {
    method: "DELETE",
  });
}

export async function updateRoute(
  routeId: string,
  updates: Partial<CaddyRoute>
): Promise<void> {
  const patchConfig: Record<string, unknown> = {};

  if (updates.domain) {
    patchConfig.match = [{ host: [updates.domain] }];
  }
  if (updates.upstream) {
    patchConfig.handle = [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: updates.upstream }],
      },
    ];
  }

  await caddyRequest(`/id/${routeId}`, {
    method: "PATCH",
    body: JSON.stringify(patchConfig),
  });
}

export async function getRoutes(): Promise<unknown[]> {
  const response = await caddyRequest(
    "/config/apps/http/servers/srv0/routes"
  );
  return (await response.json()) as unknown[];
}

export async function healthCheck(): Promise<boolean> {
  try {
    await caddyRequest("/config/");
    return true;
  } catch {
    return false;
  }
}

export async function setupPanelRoute(
  panelDomain: string,
  panelPort: number
): Promise<void> {
  await addRoute({
    id: "panelkit-dashboard",
    domain: panelDomain,
    upstream: `localhost:${panelPort}`,
  });
}
