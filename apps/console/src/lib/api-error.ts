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
export function describeError(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    const body = errorBody(cause);
    const message = body?.message;
    if (body && typeof message === "string" && message.trim() !== "") {
      const sentence = asSentenceStart(message);
      const fields = namedFields(body);
      return fields.length > 0 ? `${sentence} (${fields.join(", ")})` : sentence;
    }
    return fallback;
  }
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * An API message as the start of a sentence. The server words its errors the
 * way Go does, in lower case (`the inviter cannot accept their own
 * invitation`), and the console shows them as a line of their own, so the
 * first letter is raised here, once, for every screen. Nothing else changes:
 * the rest is the server's wording.
 */
function asSentenceStart(message: string): string {
  const text = message.trimStart();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The fields a failed request names, as {@link describeError} lists them. */
export function errorFieldNames(cause: unknown): string[] {
  const body = cause instanceof ApiError ? errorBody(cause) : undefined;
  return body ? namedFields(body) : [];
}

/** The error payload of a failed request, when it carried one. */
function errorBody(cause: ApiError): Record<string, unknown> | undefined {
  const body = cause.body;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
}

/** The fields an error payload names, from its producer's `details`. */
function namedFields(body: Record<string, unknown>): string[] {
  const fields = producerDetails(body)?.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field): field is string => typeof field === "string" && field !== "")
    .map((field) => field.replace(/^attributes\./, ""));
}

/** What the error's producer attached to an error payload (`details.details`). */
function producerDetails(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const details = body.details;
  if (!details || typeof details !== "object") return undefined;
  const producer = (details as Record<string, unknown>).details;
  return producer && typeof producer === "object"
    ? (producer as Record<string, unknown>)
    : undefined;
}

/**
 * What the server attached to a failed request beside its code and message
 * (`details.details`), or nothing when it attached none. For a screen that
 * answers a code with what the error names, such as the role already held.
 */
export function errorDetails(cause: unknown): Record<string, unknown> | undefined {
  const body = cause instanceof ApiError ? errorBody(cause) : undefined;
  return body ? producerDetails(body) : undefined;
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

/**
 * The API's error code of a failed request (ADR 030 `code`), or nothing when
 * the failure carried no payload. For the one case a screen answers
 * differently by code, such as a refusal with its own dialog.
 */
export function errorCode(cause: unknown): string | undefined {
  const code = cause instanceof ApiError ? errorBody(cause)?.code : undefined;
  return typeof code === "string" ? code : undefined;
}
