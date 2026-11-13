import { createNextgenMiddleware } from "@zitadel/sdk-nuxt/server";
import { createApp, toWebHandler } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { CLIENT_ADDRESS, describeEdgeServer } from "@zitadel/framework-contract/server-edge";

import { setRuntimeConfig } from "../stubs/nuxt-imports";

/** Sends a request through the built middleware, the way Nitro would, and returns the answer. */
async function serve(request: Request, options: NextgenMiddlewareOptions): Promise<Response> {
  const app = createApp();
  app.use((event) => {
    Object.defineProperty(event.node.req, "socket", { value: { remoteAddress: CLIENT_ADDRESS } });
  });
  app.use(createNextgenMiddleware(options));
  app.use(() => "ok");
  return toWebHandler(app)(request);
}

describeEdgeServer(serve);

// The stub behind `#imports` answers the runtime config a Nuxt app sets in `nuxt.config`.
describe("the runtime config in the edge runtime", () => {
  afterEach(() => {
    setRuntimeConfig({ nextgen: {} });
    vi.unstubAllGlobals();
  });

  it("sends the project secret from the runtime config on the handoff exchange", async () => {
    const forwarded: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded.push(new Request(input, init));
      return new Response("{}");
    });
    setRuntimeConfig({ nextgen: { projectSecret: "s3cret" } });
    await serve(
      new Request("http://localhost:3000/__nextgen/api/v1/sessions/exchange", {
        method: "POST",
        body: "{}",
      }),
      { url: "http://localhost:4000" },
    );
    expect(forwarded[0]?.url).toBe("http://localhost:4000/api/v1/sessions/exchange");
    expect(forwarded[0]?.headers.get("authorization")).toBe("Bearer s3cret");
  });
});
