import type { ErrorBody } from "./contract";
import type { Caller, Directory } from "./ports";

/** A JSON answer, `snake_case` as the contract is. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** An error answer in the contract's envelope. */
export function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } } satisfies ErrorBody, status);
}

/**
 * The person calling an RPC (root ADR 083 §4), or the answer refusing them.
 *
 * The console's session cookie is the only credential: Zitadel says whose it
 * is (`GET /sessions/me`), so the functions hold no session of their own and
 * a signed-out person is signed out here too. A call that changes something
 * must also come from the cloud's own origin, as JSON, which a form or a page
 * elsewhere cannot send: the cookie is `SameSite=Lax`, and this is the check
 * that stands where Zitadel's own CSRF token does (root ADR 053 §5).
 */
export async function authenticate(
  request: Request,
  zitadel: Directory,
): Promise<{ caller: Caller; cookie: string } | Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (!fromOwnOrigin(request)) {
      return failure(403, "cloud.origin_refused", "Only the console may call this.");
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return failure(415, "cloud.json_required", "Send the request body as JSON.");
    }
  }
  const cookie = request.headers.get("cookie") ?? "";
  const caller = cookie ? await zitadel.caller(cookie) : undefined;
  if (!caller) {
    return failure(401, "auth.session_required", "Sign in to the console first.");
  }
  return { caller, cookie };
}

/** Whether `Origin` names the host the request was sent to, as the edge forwarded it. */
export function fromOwnOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || !URL.canParse(origin)) return false;
  const host = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;
  return new URL(origin).host === host;
}
