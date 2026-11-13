import { createNextgenRequestMiddleware } from "@zitadel/sdk-tanstack-start/server";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { describeEdgeServer } from "@zitadel/server-sdk-contract/edge";

/** Sends a request through the built middleware, the way TanStack Start would, and returns the answer. */
async function serve(request: Request, options: NextgenMiddlewareOptions): Promise<Response> {
  return createNextgenRequestMiddleware({ ...options, clientAddress: "203.0.113.7" })({
    request,
    next: async () => ({ response: new Response("ok") }),
  });
}

describeEdgeServer(serve);
