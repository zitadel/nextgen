import { createZitadelRequestMiddleware } from "@zitadel/sdk-tanstack-start/server";

import type { ZitadelMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { CLIENT_ADDRESS, describeEdgeServer } from "@zitadel/server-sdk-contract/edge";

/** Sends a request through the built middleware, the way TanStack Start would, and returns the answer. */
async function serve(request: Request, options: ZitadelMiddlewareOptions): Promise<Response> {
  return createZitadelRequestMiddleware({ ...options, clientAddress: CLIENT_ADDRESS })({
    request,
    next: async () => ({ response: new Response("ok") }),
  });
}

describeEdgeServer(serve);
