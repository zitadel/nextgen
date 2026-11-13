import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
import { NextRequest } from "next/server";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { describeEdgeServer } from "@zitadel/server-sdk-contract/edge";

/** Sends a request through the built middleware, the way Next would, and returns the answer. */
async function serve(request: Request, options: NextgenMiddlewareOptions): Promise<Response> {
  const incoming = new NextRequest(request);
  // Next 15 exposes the runtime-provided address as `request.ip`.
  Object.defineProperty(incoming, "ip", { value: "203.0.113.7" });
  const answer = await nextgenMiddleware(incoming, options);
  return answer.headers.has("x-middleware-next") ? new Response("ok") : answer;
}

describeEdgeServer(serve);
