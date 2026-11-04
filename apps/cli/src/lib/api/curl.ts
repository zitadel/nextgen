import { type ApiRequest, urlOf } from "./request";

/** A shell word, single-quoted. */
const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The cURL command that sends a request, as `--dry-run` shows it. No credential
 * is ever written out: the project secret is read from
 * `$ZITADEL_PROJECT_SECRET`, as the API reference's cURL samples do, in double
 * quotes so the shell expands it, and a person's token (`zitadel login`), which
 * no variable holds, is a placeholder to replace. `as` is what the call
 * authenticates with: by default the secret for an operation that takes one.
 */
export const curlOf = (
  server: string,
  request: ApiRequest,
  as: "secret" | "login" | undefined = request.operation.auth === "secret" ? "secret" : undefined,
): string =>
  [
    `curl -X ${request.operation.method} ${quote(urlOf(server, request))}`,
    ...(as === "secret" ? ['-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"'] : []),
    ...(as === "login" ? ["-H 'Authorization: Bearer <your zitadel login access token>'"] : []),
    ...(request.body === undefined
      ? []
      : ["-H 'Content-Type: application/json'", `-d ${quote(JSON.stringify(request.body))}`]),
  ].join(" \\\n  ");
