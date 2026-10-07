/**
 * Module-global bearer token used by the orval-generated client's
 * custom fetch. Set once at command boot (the same lifecycle pattern
 * as `base-url.ts`); every generated request reads from here.
 *
 * Keeping the token here means the CLI doesn't have to thread an
 * `Authorization` header through every generated call site; orval's
 * `mutator` wires `runtime/fetch.ts` in, and that file pulls the token
 * from this module.
 */
let apiAuthToken: string | undefined;

export function getApiAuthToken(): string | undefined {
  return apiAuthToken;
}

export function setApiAuthToken(token: string | undefined): void {
  apiAuthToken = token;
}

/**
 * The CSRF token for the first-party browser surfaces (ADR 053 §5). A
 * state-changing request that the `__nextgen_session` cookie authenticates must
 * carry the session's token — `csrf_token` from `GET /sessions/me/csrf` — in the
 * `X-Zitadel-CSRF` header. The app sets it once it has loaded its session;
 * `runtime/fetch.ts` then adds the header to unsafe requests. Unset (every
 * other caller), nothing is added.
 *
 * The token belongs to the server that issued it, so it is stored with that
 * server's origin and only sent there: another client on the same page, with
 * another base URL, never carries it to a different host. The origin defaults
 * to the page's own, which is where a same-origin app's API lives; with no
 * origin to go by (no page, or an unparsable request URL), nothing is sent.
 *
 * Unlike the bearer slot, the app sets this one rather than the client, so it
 * lives on `globalThis` under a {@link Symbol.for} key, like the project slot in
 * `config.ts`: a second copy of this module (an SDK pinning another version)
 * must read the token the app's copy wrote.
 */
const CSRF_SLOT = Symbol.for("@zitadel/api/auth:csrf");

interface CsrfSlot {
  token?: string;
  tokenOrigin?: string;
  onRejected?: () => Promise<string | undefined>;
  handlerOrigin?: string;
}

function csrfSlot(): CsrfSlot {
  const global = globalThis as Record<symbol, CsrfSlot | undefined>;
  return (global[CSRF_SLOT] ??= {});
}

function pageOrigin(): string | undefined {
  return (globalThis as { location?: { origin?: string } }).location?.origin;
}

export function getApiCsrfToken(): string | undefined {
  return csrfSlot().token;
}

/**
 * Stores the session's CSRF token for the server at `origin` (default: the
 * page's own). `undefined` clears it.
 */
export function setApiCsrfToken(token: string | undefined, origin = pageOrigin()): void {
  const slot = csrfSlot();
  slot.token = token;
  slot.tokenOrigin = token === undefined ? undefined : origin;
}

/** The token to send to `origin`, if it was issued there. */
export function apiCsrfTokenFor(origin: string | undefined): string | undefined {
  const slot = csrfSlot();
  return origin !== undefined && slot.tokenOrigin === origin ? slot.token : undefined;
}

/**
 * Registers what to do when a state-changing request to `origin` (default: the
 * page's own) is refused with `403 auth.csrf_invalid`: the token is tied to the
 * session cookie, which another tab can replace by signing in again, or it was
 * never loaded. A refusal from any other host is not this session's business
 * and is left alone.
 *
 * The handler re-checks the session. It returns a fresh token only when the
 * session still belongs to the person the request was made for; `customFetch`
 * then retries the request once with it. Returning `undefined` (someone else,
 * or nobody, is signed in now) leaves the request refused, so a write is never
 * replayed under a session it was not prepared for.
 */
export function setApiCsrfRejectionHandler(
  onRejected: (() => Promise<string | undefined>) | undefined,
  origin = pageOrigin(),
): void {
  const slot = csrfSlot();
  slot.onRejected = onRejected;
  slot.handlerOrigin = onRejected === undefined ? undefined : origin;
}

export function getApiCsrfRejectionHandler(): (() => Promise<string | undefined>) | undefined {
  return csrfSlot().onRejected;
}

/** The rejection handler for a refusal from `origin`, if it was registered for it. */
export function apiCsrfRejectionHandlerFor(
  origin: string | undefined,
): (() => Promise<string | undefined>) | undefined {
  const slot = csrfSlot();
  return origin !== undefined && slot.handlerOrigin === origin ? slot.onRejected : undefined;
}
