import { createNextgenMiddleware } from "@zitadel/sdk-solid-start/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

/** Sends a request through the built middleware, the way SolidStart would, and returns the answer. */
async function serve(request: Request, options: NextgenMiddlewareOptions): Promise<Response> {
  const [onRequest] = createNextgenMiddleware(options).onRequest;
  if (!onRequest) throw new Error("the middleware registers no onRequest handler");
  const answer = await onRequest({ request, locals: {}, clientAddress: "203.0.113.7" });
  return answer ?? new Response("ok");
}

// edge-server:begin
/**
 * Sends requests through the built package, as a consumer's bundler resolves it,
 * inside the `edge-runtime` VM (the `edge` project in `vitest.config.ts`), which has
 * no Node built-ins, with dependencies resolved the way a bundler resolves them for
 * the edge.
 */
describe("the server SDK in the edge runtime", () => {
  const ORIGIN = "http://localhost:3000";
  const BACKEND = "http://localhost:4000";
  const options: NextgenMiddlewareOptions = {
    url: BACKEND,
    projectId: "proj_app",
    protectedRoutes: ["/admin"],
    loginPath: "/login",
  };
  const forwarded: Request[] = [];

  beforeEach(() => {
    forwarded.length = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded.push(new Request(input, init));
      return new Response("pong");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers a protected route with a redirect to the login path", async () => {
    const answer = await serve(new Request(`${ORIGIN}/admin`), options);
    expect(answer.status).toBe(302);
    expect(new URL(answer.headers.get("location") ?? "", ORIGIN).pathname).toBe("/login");
    expect(forwarded).toHaveLength(0);
  });

  it("forwards the proxy path to the backend", async () => {
    const answer = await serve(
      new Request(`${ORIGIN}/__nextgen/ping?x=1`, {
        method: "POST",
        headers: {
          authorization: "Bearer abc",
          connection: "keep-alive",
          "content-type": "text/plain",
          cookie: "theme=dark",
          "x-forwarded-for": "198.51.100.1",
          "x-real-ip": "192.0.2.99",
        },
        body: "payload",
      }),
      options,
    );
    expect(await answer.text()).toBe("pong");
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.url).toBe(`${BACKEND}/ping?x=1`);
    expect(forwarded[0]?.method).toBe("POST");
    expect(await forwarded[0]?.text()).toBe("payload");
    expect(forwarded[0]?.headers.get("authorization")).toBe("Bearer abc");
    expect(forwarded[0]?.headers.get("cookie")).toBe("theme=dark");
    expect(forwarded[0]?.headers.get("content-type")).toBe("text/plain");
    expect(forwarded[0]?.headers.get("x-forwarded-for")).toBe("198.51.100.1, 203.0.113.7");
    expect(forwarded[0]?.headers.has("connection")).toBe(false);
  });

  it("forwards a GET on the proxy path as a GET", async () => {
    await serve(new Request(`${ORIGIN}/__nextgen/ping`), options);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.url).toBe(`${BACKEND}/ping`);
    expect(forwarded[0]?.method).toBe("GET");
    expect(forwarded[0]?.headers.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("refuses a request that carries the auth header before forwarding it", async () => {
    const answer = await serve(
      new Request(`${ORIGIN}/__nextgen/ping`, { headers: { "x-nextgen-auth-token": "forged" } }),
      options,
    );
    expect(answer.status).toBe(400);
    expect(forwarded).toHaveLength(0);
  });

  it("passes an unprotected route through", async () => {
    const answer = await serve(new Request(`${ORIGIN}/`), options);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("ok");
    expect(forwarded).toHaveLength(0);
  });
});
// edge-server:end
