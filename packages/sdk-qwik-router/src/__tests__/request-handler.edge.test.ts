import { createNextgenOnRequest } from "@zitadel/sdk-qwik-router/server";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { CLIENT_ADDRESS, describeEdgeServer } from "@zitadel/server-sdk-contract/edge";

/** Sends a request through the built handler, the way Qwik Router would, and returns the answer. */
async function serve(request: Request, options: NextgenMiddlewareOptions): Promise<Response> {
  let sent: Response | undefined;
  try {
    await createNextgenOnRequest(options)({
      request,
      url: new URL(request.url),
      sharedMap: new Map(),
      clientConn: { ip: CLIENT_ADDRESS },
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

describeEdgeServer(serve);
