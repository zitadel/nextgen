import { request as send } from "@zitadel/api/runtime/fetch";

import { translateFailure } from "./client";

/**
 * The few transport facts a caller that sends its own request needs: where the
 * API lives under a server, the header its CSRF token travels in, the request
 * function that honours a signal and a deadline, and the paging reader. Every
 * other call goes through a service.
 */
export { API_PREFIX, apiBaseUrl } from "@zitadel/api/runtime/base-url";
export { CSRF_HEADER } from "@zitadel/api/runtime/fetch";
export { Paging } from "@zitadel/api/runtime/paging";

/**
 * Send one request the way the client sends its own, and fail the way the
 * client fails.
 *
 * The transport's own failure type is the backend's to keep: outside it there
 * is nothing that knows a connection that was refused from a body that could
 * not be read, so a failure that left here untranslated would reach the CLI as
 * an unclassified error and be reported as a bad request. Only a caller the
 * generated client has no function for comes here — a response read for a
 * header it does not expose — and it is still held to the same failures as
 * everything else.
 *
 * A cancellation is not a transport failure and is answered as it came, so
 * Ctrl-C still reads as cancelled rather than as an unreachable server.
 *
 * @param args - The URL, the request, the signal and deadline, and the body reader.
 * @returns The response, and the body the reader read.
 * @throws BackendError for any failure of the transport.
 */
export async function request<R = undefined>(
  ...args: Parameters<typeof send<R>>
): Promise<Awaited<ReturnType<typeof send<R>>>> {
  try {
    return await send<R>(...args);
  } catch (error) {
    throw translateFailure(error);
  }
}
