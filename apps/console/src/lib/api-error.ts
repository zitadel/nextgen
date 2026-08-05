import { ApiError } from "@zitadel/api/runtime/fetch";

/**
 * The message to show for a failed request.
 *
 * **The API owns this copy.** ADR 030 defines the error payload's `message` as
 * the human-facing string, so it is rendered verbatim rather than mapped to
 * console-authored text — the console has no design source for error strings and
 * no i18n layer, so re-writing them would only fork the wording per client.
 *
 * The message lives in the response *body* (`error-details.yaml`).
 * `ApiError.message` is a transport-level string (`POST /users returned 409`,
 * built in `runtime/fetch.ts`) and must never reach an operator, so the body is
 * read explicitly. `fallback` covers the case where there is no payload at all —
 * a network failure or a non-JSON response.
 *
 * Attributing a `409` to a specific input is deliberately not attempted:
 * `ErrUserAlreadyExists()` carries no details and ADR 030 records that `details`
 * is never populated today, so the response cannot say which value collided.
 * Guessing from the schema's `x-unique` markers would put console-authored copy
 * under a field the server never named.
 */
export function describeError(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    const body = cause.body;
    if (body && typeof body === "object") {
      const message = (body as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim() !== "") return message;
    }
    return fallback;
  }
  return cause instanceof Error ? cause.message : fallback;
}
