import { createNextgenMiddleware } from "@zitadel/sdk-nuxt/server";
import { createApp, toWebHandler } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

/** Sends a request through the built middleware, the way Nitro would, and returns the answer. */
async function serve(url: string, options: NextgenMiddlewareOptions): Promise<Response> {
  const app = createApp();
  app.use(createNextgenMiddleware(options));
  app.use(() => "ok");
  return toWebHandler(app)(new Request(url, { headers: { host: new URL(url).host } }));
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
