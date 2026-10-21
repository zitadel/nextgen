import { type ApiRequest, urlOf } from "./request";

/** A shell word, single-quoted. */
const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The cURL command that sends a request, as `--dry-run` shows it. The project
 * secret is never written out: an operation that needs it reads it from
 * `$ZITADEL_PROJECT_SECRET`, as the API reference's cURL samples do, in double
 * quotes so the shell expands it.
 */
export const curlOf = (server: string, request: ApiRequest): string =>
  [
    `curl -X ${request.operation.method} ${quote(urlOf(server, request))}`,
    ...(request.operation.auth === "secret"
      ? ['-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"']
      : []),
    ...(request.body === undefined
      ? []
      : ["-H 'Content-Type: application/json'", `-d ${quote(JSON.stringify(request.body))}`]),
  ].join(" \\\n  ");
