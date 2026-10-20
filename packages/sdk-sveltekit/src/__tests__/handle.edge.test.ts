import type { RequestEvent } from "@sveltejs/kit";

import { createNextgenHandle } from "@zitadel/sdk-sveltekit/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

/** A span that records nothing, which is all `event.tracing` needs while tracing is off. */
const span: RequestEvent["tracing"]["root"] = {
  spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
  setAttribute: () => span,
  setAttributes: () => span,
  addEvent: () => span,
  addLink: () => span,
  addLinks: () => span,
  setStatus: () => span,
  updateName: () => span,
  end: () => {},
  isRecording: () => false,
  recordException: () => {},
};

/** Sends a request through the built handle, the way SvelteKit would, and returns the answer. */
async function serve(url: string, options: NextgenMiddlewareOptions): Promise<Response> {
  const event: RequestEvent = {
    url: new URL(url),
    request: new Request(url),
    cookies: {
      get: () => undefined,
      parse: () => ({ name: "", value: "" }),
      getAll: () => [],
      set: () => {},
      delete: () => {},
      serialize: () => "",
    },
    locals: {},
    params: {},
    platform: undefined,
    route: { id: null },
    fetch,
    getClientAddress: () => "203.0.113.7",
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: { enabled: false, root: span, current: span },
  };
  return createNextgenHandle(options)({ event, resolve: () => new Response("ok") });
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
