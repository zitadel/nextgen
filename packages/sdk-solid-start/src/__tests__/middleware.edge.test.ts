import { createZitadelMiddleware } from "@zitadel/sdk-solid-start/server";

import type { ZitadelMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { CLIENT_ADDRESS, describeEdgeServer } from "@zitadel/server-sdk-contract/edge";

/** Sends a request through the built middleware, the way SolidStart would, and returns the answer. */
async function serve(request: Request, options: ZitadelMiddlewareOptions): Promise<Response> {
  const [onRequest] = createZitadelMiddleware(options).onRequest;
  if (!onRequest) throw new Error("the middleware registers no onRequest handler");
  const answer = await onRequest({ request, locals: {}, clientAddress: CLIENT_ADDRESS });
  return answer ?? new Response("ok");
}

describeEdgeServer(serve);
