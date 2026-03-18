import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../../server/config";

// Mock Caddy server
let mockServer: ReturnType<typeof Bun.serve> | null = null;
let lastRequest: { method: string; path: string; body?: string } | null = null;
let mockResponse: { status: number; body: string } = {
  status: 200,
  body: "{}",
};

function startMockCaddy(port: number) {
  mockServer = Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      const body = req.method !== "GET" && req.method !== "DELETE"
        ? await req.text()
        : undefined;

      lastRequest = {
        method: req.method,
        path: url.pathname,
        body,
      };

      return new Response(mockResponse.body, {
        status: mockResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}

function stopMockCaddy() {
  if (mockServer) {
    mockServer.stop(true);
    mockServer = null;
  }
}

// We need to dynamically import caddy.service after setting config
// to ensure it picks up the correct admin URL
async function getCaddyService() {
  // Clear module cache to pick up new config
  return await import("../../server/services/caddy.service");
}

describe("Caddy Service", () => {
  const MOCK_PORT = 19876;

  beforeEach(() => {
    loadConfig({
      NODE_ENV: "test",
      CADDY_ADMIN_URL: `http://localhost:${MOCK_PORT}`,
      MASTER_KEY: "a".repeat(64),
    });
    lastRequest = null;
    mockResponse = { status: 200, body: "{}" };
    startMockCaddy(MOCK_PORT);
  });

  afterEach(() => {
    stopMockCaddy();
  });

  it("addRoute sends correct JSON to Caddy admin API", async () => {
    const caddy = await getCaddyService();

    await caddy.addRoute({
      id: "app-123",
      domain: "myapp.example.com",
      upstream: "localhost:4001",
    });

    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.method).toBe("POST");
    expect(lastRequest!.path).toBe(
      "/config/apps/http/servers/srv0/routes"
    );

    const body = JSON.parse(lastRequest!.body!);
    expect(body["@id"]).toBe("app-123");
    expect(body.match[0].host[0]).toBe("myapp.example.com");
    expect(body.handle[0].handler).toBe("reverse_proxy");
    expect(body.handle[0].upstreams[0].dial).toBe("localhost:4001");
  });

  it("removeRoute sends DELETE to correct @id path", async () => {
    const caddy = await getCaddyService();

    await caddy.removeRoute("app-123");

    expect(lastRequest!.method).toBe("DELETE");
    expect(lastRequest!.path).toBe("/id/app-123");
  });

  it("updateRoute sends PATCH with partial config", async () => {
    const caddy = await getCaddyService();

    await caddy.updateRoute("app-123", {
      upstream: "localhost:4002",
    });

    expect(lastRequest!.method).toBe("PATCH");
    expect(lastRequest!.path).toBe("/id/app-123");

    const body = JSON.parse(lastRequest!.body!);
    expect(body.handle[0].upstreams[0].dial).toBe("localhost:4002");
  });

  it("handles Caddy API returning 400", async () => {
    const caddy = await getCaddyService();
    mockResponse = { status: 400, body: '{"error": "bad request"}' };

    try {
      await caddy.addRoute({
        id: "bad",
        domain: "bad.com",
        upstream: "localhost:1",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(caddy.CaddyError);
      expect((e as any).statusCode).toBe(400);
    }
  });

  it("handles Caddy API returning 500", async () => {
    const caddy = await getCaddyService();
    mockResponse = { status: 500, body: '{"error": "internal"}' };

    try {
      await caddy.addRoute({
        id: "err",
        domain: "err.com",
        upstream: "localhost:1",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(caddy.CaddyError);
      expect((e as any).statusCode).toBe(500);
    }
  });

  it("handles Caddy being unreachable", async () => {
    stopMockCaddy(); // Stop the mock server
    const caddy = await getCaddyService();

    try {
      await caddy.addRoute({
        id: "x",
        domain: "x.com",
        upstream: "localhost:1",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(caddy.CaddyError);
      expect((e as any).message).toContain("Cannot connect to Caddy");
    }
  });

  it("health check returns true when Caddy is up", async () => {
    const caddy = await getCaddyService();
    mockResponse = { status: 200, body: '{"apps":{}}' };

    const result = await caddy.healthCheck();
    expect(result).toBe(true);
  });

  it("health check returns false when Caddy is down", async () => {
    stopMockCaddy();
    const caddy = await getCaddyService();

    const result = await caddy.healthCheck();
    expect(result).toBe(false);
  });
});
