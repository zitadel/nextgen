/**
 * What a {@link ZitadelClient} is made from. Only `baseUrl` must be given;
 * everything else has a meaning when left out, written on each property.
 */
export type ZitadelClientSettings = Readonly<{
  /**
   * The server's origin (`https://example.com`) or a same-origin proxy path
   * (`/__nextgen`). The API prefix (ADR 077) follows it on every request, and
   * a base that already ends in it keeps one; trailing slashes go.
   */
  baseUrl: string;
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
   * The `fetch` every request is sent through. Left out, the runtime's own
   * `fetch`, looked up when each request is sent.
   *
   * This is where an environment adds what only it needs without the client
   * knowing: a header only one app sends, a retry, a log of requests. It is
   * called with the full URL and the request the client built, and its
   * response is read as the server's.
   */
  fetch?: typeof fetch;
  /**
   * Called before every request the client sends, with the operation, its URL
   * and the request as it will go out. Throwing stops the request: nothing is
   * sent, and the call rejects with what was thrown. Left out, every request
   * is sent. It sees a copy, so changing it changes nothing that is sent, and
   * it runs before the client's signal and deadline apply: it must return on
   * its own.
   *
   * This is where the code that owns a client adds a rule of its own without
   * the client knowing it: a command line that refuses a destructive operation
   * the person has not agreed to, a test that records what was sent, a log.
   */
  onRequest?: (request: ZitadelRequest) => void | Promise<void>;
}>;

/**
 * One request as {@link ZitadelClientSettings.onRequest} sees it, before it
 * is sent.
 */
export type ZitadelRequest = Readonly<{
  /**
   * The generated function that sends it, such as `deleteUser`: the
   * operation's id with its first letter lowercased.
   */
  operation: string;
  /**
   * The full URL, the client's base URL and the API prefix included.
   */
  url: string;
  /**
   * The request, its headers as the client set them.
   */
  init: Omit<RequestInit, "headers"> & { headers: Headers };
}>;

/**
 * What {@link ZitadelClient.with} may change: any setting, where `baseUrl`,
 * which a client cannot be without, may not be cleared.
 */
export type ZitadelClientChanges = Readonly<
  Partial<Omit<ZitadelClientSettings, "baseUrl">> & { baseUrl?: string }
>;

/**
 * One connection to a Zitadel server: where it is, what to authenticate with,
 * and what every request it makes is bound by.
 *
 * A client is immutable. Its settings are read-only and frozen, and
 * {@link ZitadelClient.with} returns a new client rather than changing this one,
 * so two clients on one page (an app's own and the sign-in widget's) can never
 * see each other's server, token, deadline, signal or `fetch`. Nothing about a request
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
   * The `fetch` requests are sent through, or `undefined` for the runtime's.
   */
  readonly fetch: typeof fetch | undefined;

  /**
   * What runs before every request, or `undefined` for nothing.
   */
  readonly onRequest: ((request: ZitadelRequest) => void | Promise<void>) | undefined;

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
    this.token = settings.token;
    this.signal = settings.signal;
    this.timeoutMs = settings.timeoutMs;
    this.userAgent = settings.userAgent;
    this.fetch = settings.fetch;
    this.onRequest = settings.onRequest;
    Object.freeze(this);
  }

  /**
   * A new client with `changes` applied over this one's settings; this client
   * is left as it was. A property set to `undefined` clears it.
   *
   * @param changes - The settings to change.
   * @returns The new client.
   * @example
   * const elsewhere = client.with({ baseUrl: "https://other.example.com" });
   * const anonymous = client.with({ token: undefined });
   */
  with(changes: ZitadelClientChanges): ZitadelClient {
    return new ZitadelClient({
      ...this.#settings,
      ...changes,
      baseUrl: changes.baseUrl ?? this.#settings.baseUrl,
    });
  }
}
