/**
 * The session-bound CSRF token of a first-party browser surface (ADR 053 §5),
 * and what to do when the server refuses it.
 *
 * A state-changing request that the session cookie authenticates must carry
 * the session's token in the `X-Zitadel-CSRF` header. The token belongs to the
 * server that issued it, so a client sends it only to `origin`: a request to any
 * other host carries no token, and a refusal from any other host is not this
 * session's business.
 *
 * The client itself never changes, but the session behind it does, so the
 * token is read through {@link CsrfProvider.token} on every request rather than
 * copied into the client.
 *
 * @example
 * const csrf: CsrfProvider = {
 *   origin: window.location.origin,
 *   token: () => session.csrfToken,
 *   refresh: () => session.reload().then(() => session.csrfToken),
 * };
 */
export type CsrfProvider = Readonly<{
  /**
   * The origin of the server that issued the token, such as
   * `https://example.com`. Only requests to this origin carry it.
   */
  origin: string;
  /**
   * The token to send now, or `undefined` when none is loaded yet; then the
   * request goes without one.
   */
  token: () => string | undefined;
  /**
   * Called once when a state-changing request to {@link CsrfProvider.origin}
   * is refused with `403 auth.csrf_invalid`: the token is tied to the session
   * cookie, which another tab can replace by signing in again, or it was never
   * loaded. Re-check the session, and return a fresh token only when it still
   * belongs to the person the request was made for; the request is then sent
   * again once with it. Returning `undefined` (someone else, or nobody, is
   * signed in now) leaves the request refused, so a write is never replayed
   * under a session it was not prepared for.
   */
  refresh: () => Promise<string | undefined>;
}>;

/**
 * What a {@link ZitadelClient} is made from. Only `baseUrl` and
 * `allowDestructive` must be decided by every caller; everything else has a
 * meaning when left out, written on each property.
 */
export type ZitadelClientSettings = Readonly<{
  /**
   * The server's origin (`https://example.com`) or a same-origin proxy path
   * (`/__nextgen`). The API prefix (ADR 077) follows it on every request, and
   * a base that already ends in it keeps one; trailing slashes go.
   */
  baseUrl: string;
  /**
   * Whether this client may run a destructive operation: every `DELETE`, and
   * any operation the spec marks `x-zitadel-destructive`. A client that may
   * not rejects such a call with a {@link DestructiveOperationError} before
   * anything is sent, whichever way the operation was reached. There is no
   * default, so every caller says which it wants.
   */
  allowDestructive: boolean;
  /**
   * The bearer token sent on every request that does not set its own
   * `Authorization` header. Left out, requests carry none: cookie-authenticated
   * browser calls, and the unauthenticated `POST /projects`.
   */
  token?: string;
  /**
   * Aborts every request this client makes. A request it cuts off rejects
   * with the signal's own reason rather than a `NetworkError`. Left out,
   * only a signal on the call itself cancels it.
   */
  signal?: AbortSignal;
  /**
   * The deadline for each request, response body included. A request that
   * runs past it rejects with a `NetworkError` whose reason is `timeout`.
   * Left out, there is no deadline beyond the runtime's own.
   */
  timeoutMs?: number;
  /**
   * The `User-Agent` every request carries, so a server and its logs can tell
   * one caller from another. Left out, the runtime's own.
   */
  userAgent?: string;
  /**
   * The session's CSRF token, for a first-party browser surface. Left out,
   * no request carries one.
   */
  csrf?: CsrfProvider;
}>;

/**
 * One connection to a Zitadel server: where it is, what to authenticate with,
 * and what every request it makes is bound by.
 *
 * A client is immutable. Its settings are read-only and frozen, and
 * {@link ZitadelClient.with} returns a new client rather than changing this one,
 * so two clients on one page (an app's own and the sign-in widget's) can never
 * see each other's server, token, deadline or signal. Nothing about a request
 * is held anywhere but in the client the request was made with.
 *
 * Every generated operation takes the client as its first argument:
 *
 * @example
 * import { ZitadelClient } from "@zitadel/api/runtime/client";
 * import { getProject } from "@zitadel/api/generated/endpoints/zitadelNextGen";
 *
 * const client = new ZitadelClient({
 *   baseUrl: "https://example.com",
 *   token: process.env.ZITADEL_SECRET,
 *   allowDestructive: false,
 * });
 * const project = await getProject(client, projectId);
 */
export class ZitadelClient {
  /**
   * The settings this client was made from. A private field, so only a value
   * this class constructed is a `ZitadelClient`: an object literal with the
   * same properties does not type-check as one.
   */
  readonly #settings: ZitadelClientSettings;

  /**
   * The server's origin or a same-origin proxy path, without trailing slashes.
   */
  readonly baseUrl: string;

  /**
   * Whether this client may run a destructive operation.
   */
  readonly allowDestructive: boolean;

  /**
   * The bearer token, or `undefined` when requests carry none.
   */
  readonly token: string | undefined;

  /**
   * The signal that aborts every request, or `undefined` for none.
   */
  readonly signal: AbortSignal | undefined;

  /**
   * The deadline of each request in milliseconds, or `undefined` for none.
   */
  readonly timeoutMs: number | undefined;

  /**
   * The `User-Agent` of every request, or `undefined` for the runtime's own.
   */
  readonly userAgent: string | undefined;

  /**
   * The CSRF token's source, or `undefined` when requests carry none.
   */
  readonly csrf: CsrfProvider | undefined;

  /**
   * @param settings - Where the server is, what to authenticate with, and
   * what every request is bound by.
   */
  constructor(settings: ZitadelClientSettings) {
    let baseUrl = settings.baseUrl;
    while (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    this.#settings = Object.freeze({ ...settings });
    this.baseUrl = baseUrl;
    this.allowDestructive = settings.allowDestructive === true;
    this.token = settings.token;
    this.signal = settings.signal;
    this.timeoutMs = settings.timeoutMs;
    this.userAgent = settings.userAgent;
    this.csrf = settings.csrf;
    Object.freeze(this);
  }

  /**
   * A new client with `changes` applied over this one's settings; this client
   * is left as it was. A property set to `undefined` clears it.
   *
   * @param changes - The settings to change.
   * @returns The new client.
   * @example
   * const admin = client.with({ allowDestructive: true });
   * const anonymous = client.with({ token: undefined });
   */
  with(changes: Partial<ZitadelClientSettings>): ZitadelClient {
    return new ZitadelClient({ ...this.#settings, ...changes });
  }
}
