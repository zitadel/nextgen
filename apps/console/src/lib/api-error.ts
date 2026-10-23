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
 * When the server names the fields a request failed on (`details.details.fields`,
 * as a `400 req.invalid` or a taken unique value does), they are appended after
 * the message: the `req.invalid` message tells the reader to check them. They
 * are listed as the server named them, minus the `attributes.` prefix of the
 * request body, and never guessed from the schema's `x-unique` markers.
 */
export function describeError(
  cause: unknown,
  fallback: string,
  /** False when the form shows the named fields on the fields themselves. */
  withFields = true,
): string {
  if (cause instanceof ApiError) {
    const body = cause.body;
    if (body && typeof body === "object") {
      const message = (body as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim() !== "") {
        const fields = withFields ? invalidFields(cause) : [];
        return fields.length > 0 ? `${message} (${fields.join(", ")})` : message;
      }
    }
    return fallback;
  }
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * The fields a failed request names, from its producer's `details`, as
 * attribute keys: the `attributes.` prefix of the request body is dropped, so
 * a form can match them to its own controls. Empty for any other failure.
 */
export function invalidFields(cause: unknown): string[] {
  if (!(cause instanceof ApiError)) return [];
  const body = cause.body;
  if (!body || typeof body !== "object") return [];
  const details = (body as Record<string, unknown>).details;
  if (!details || typeof details !== "object") return [];
  const producer = (details as Record<string, unknown>).details;
  if (!producer || typeof producer !== "object") return [];
  const fields = (producer as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field): field is string => typeof field === "string" && field !== "")
    .map((field) => field.replace(/^attributes\./, ""));
}

/**
 * The read's answer, or `null` when it is refused (403): for a read that is
 * chrome on its screen, where a refusal costs that part rather than the page.
 * Any other failure still throws.
 */
export async function nullOnForbidden<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 403) return null;
    throw cause;
  }
}
