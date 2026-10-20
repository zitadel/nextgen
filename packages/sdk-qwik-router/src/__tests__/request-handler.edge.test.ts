import { createNextgenOnRequest } from "@zitadel/sdk-qwik-router/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

/** Sends a request through the built handler, the way Qwik Router would, and returns the answer. */
async function serve(url: string, options: NextgenMiddlewareOptions): Promise<Response> {
  let sent: Response | undefined;
  try {
    await createNextgenOnRequest(options)({
      request: new Request(url),
      url: new URL(url),
      sharedMap: new Map(),
      clientConn: { ip: "203.0.113.7" },
      cookie: { get: () => null, getAll: () => ({}), set: () => {}, delete: () => {} },
      send: (response) => {
        sent = response;
      },
      redirect: (status, location) => new Response(null, { status, headers: { location } }),
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
  return sent ?? new Response("ok");
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers a protected route with a redirect to the login path", async () => {
    const answer = await serve(`${ORIGIN}/admin`, options);
    expect(answer.status).toBe(302);
    expect(new URL(answer.headers.get("location") ?? "", ORIGIN).pathname).toBe("/login");
  });

  it("forwards the proxy path to the backend", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return new Response("pong");
    });
    const answer = await serve(`${ORIGIN}/__nextgen/ping`, options);
    expect(fetched).toEqual([`${BACKEND}/ping`]);
    expect(await answer.text()).toBe("pong");
  });

  it("passes an unprotected route through", async () => {
    const answer = await serve(`${ORIGIN}/`, options);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("ok");
  });
});
// edge-server:end
