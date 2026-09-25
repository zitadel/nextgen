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
 * Module-global CSRF token for the first-party browser surfaces (ADR 053 §5).
 * A state-changing management request that the `__nextgen_session` cookie
 * authenticates must carry the session's token — `csrf_token` from
 * `GET /sessions/me` — in the `X-Zitadel-CSRF` header. The Console sets it
 * once it has loaded its session; `runtime/fetch.ts` then adds the header to
 * every unsafe request. Unset (every other caller), nothing is added.
 */
let apiCsrfToken: string | undefined;

export function getApiCsrfToken(): string | undefined {
  return apiCsrfToken;
}

export function setApiCsrfToken(token: string | undefined): void {
  apiCsrfToken = token;
}
