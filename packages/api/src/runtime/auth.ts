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
 * `runtime/fetch.ts` then adds the header to every unsafe request. Unset
 * (every other caller), nothing is added.
 *
 * Unlike the bearer slot, the app sets this one rather than the client, so it
 * lives on `globalThis` under a {@link Symbol.for} key, like the project slot in
 * `config.ts`: a second copy of this module (an SDK pinning another version)
 * must read the token the app's copy wrote.
 */
const CSRF_SLOT = Symbol.for("@zitadel/api/auth:csrf");

interface CsrfSlot {
  token?: string;
  refresh?: () => Promise<string | undefined>;
}

function csrfSlot(): CsrfSlot {
  const global = globalThis as Record<symbol, CsrfSlot | undefined>;
  return (global[CSRF_SLOT] ??= {});
}

export function getApiCsrfToken(): string | undefined {
  return csrfSlot().token;
}

export function setApiCsrfToken(token: string | undefined): void {
  csrfSlot().token = token;
}

/**
 * Registers how to re-read the session's CSRF token. The token is tied to the
 * session cookie, which another tab can replace (sign out and in again); a write
 * from this tab then answers `403 auth.csrf_invalid`. `customFetch` calls the
 * refresher once on that answer and retries with the token it returns.
 */
export function setApiCsrfTokenRefresher(refresh: (() => Promise<string | undefined>) | undefined): void {
  csrfSlot().refresh = refresh;
}

export function getApiCsrfTokenRefresher(): (() => Promise<string | undefined>) | undefined {
  return csrfSlot().refresh;
}
