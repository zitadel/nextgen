import type { RequestEvent } from "@sveltejs/kit";

import { createNextgenHandle } from "@zitadel/sdk-sveltekit/server";

import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { CLIENT_ADDRESS, describeEdgeServer } from "@zitadel/server-sdk-contract/edge";

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
async function serve(request: Request, options: NextgenMiddlewareOptions): Promise<Response> {
  const event: RequestEvent = {
    url: new URL(request.url),
    request,
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
    getClientAddress: () => CLIENT_ADDRESS,
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: { enabled: false, root: span, current: span },
  };
  return createNextgenHandle(options)({ event, resolve: () => new Response("ok") });
}

describeEdgeServer(serve);
