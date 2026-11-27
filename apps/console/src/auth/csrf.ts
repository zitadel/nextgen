import type { CsrfProvider } from "@zitadel/api/runtime/client";

/**
 * The console session's CSRF token (ADR 053 §5), which every state-changing
 * request the session cookie authenticates must carry. `session.ts` loads it
 * once the session is known to be active and drops it with the session.
 */
let token: string | undefined;

/** What `session.ts` runs when a write was refused with `403 auth.csrf_invalid`. */
let refresher: (() => Promise<string | undefined>) | undefined;

/**
 * The token the console's requests carry now, if one is loaded.
 *
 * @returns The token, or `undefined` before the session loaded one.
 */
export function getCsrfToken(): string | undefined {
  return token;
}

/**
 * Stores the session's token; `undefined` drops it.
 *
 * @param value - The token from `GET /sessions/me/csrf`.
 */
export function setCsrfToken(value: string | undefined): void {
  token = value;
}

/**
 * Registers the re-check that runs when a write is refused for its token. It
 * returns a fresh token only when the session still belongs to this page's
 * person; the client then sends the write once more with it.
 *
 * @param refresh - The re-check.
 */
export function setCsrfRefresh(refresh: () => Promise<string | undefined>): void {
  refresher = refresh;
}

/**
 * The console client's CSRF source: the token above, sent only to the API's
 * `origin`, and the registered re-check on a refusal.
 *
 * @param origin - The origin the console's API requests go to.
 * @returns The provider the console's client reads on every request.
 */
export function csrfProvider(origin: string): CsrfProvider {
  return Object.freeze({
    origin,
    token: () => token,
    refresh: () => (refresher ? refresher() : Promise.resolve(undefined)),
  });
}
