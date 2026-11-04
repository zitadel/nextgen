import type { ApiRequest } from "../../lib/backend";

/** A shell word, single-quoted. */
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The cURL command that sends a request. The project secret is never written
 * out: an operation that needs it reads it from `$ZITADEL_PROJECT_SECRET`, as
 * the API reference's cURL samples do, in double quotes so the shell expands it.
 *
 * @param server - The server's URL.
 * @param request - The request.
 * @returns The command.
 */
export function curlOf(server: string, request: ApiRequest): string {
  return [
    `curl -X ${request.operation.method} ${quote(request.operation.urlOn(server, request))}`,
    ...(request.operation.auth === "secret"
      ? ['-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"']
      : []),
    ...(request.body === undefined
      ? []
      : ["-H 'Content-Type: application/json'", `-d ${quote(JSON.stringify(request.body))}`]),
  ].join(" \\\n  ");
}
