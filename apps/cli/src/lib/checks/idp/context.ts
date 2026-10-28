/** The fields of an OpenID discovery document the checks read. */
export type Discovery = {
  readonly issuer?: string;
  readonly authorization_endpoint?: string;
  readonly token_endpoint?: string;
  readonly jwks_uri?: string;
  readonly userinfo_endpoint?: string;
  readonly scopes_supported?: readonly string[];
  readonly claims_supported?: readonly string[];
  readonly code_challenge_methods_supported?: readonly string[];
};

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const textsOf = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;

/**
 * Keeps only the fields that have the type the checks rely on, so a provider
 * that answers `"scopes_supported": "openid email"` reads as not saying, never
 * as a list the checks would search by substring.
 */
export function discoveryOf(raw: unknown): Discovery {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Partial<Record<keyof Discovery, unknown>>)
      : {};
  return {
    issuer: textOf(record.issuer),
    authorization_endpoint: textOf(record.authorization_endpoint),
    token_endpoint: textOf(record.token_endpoint),
    jwks_uri: textOf(record.jwks_uri),
    userinfo_endpoint: textOf(record.userinfo_endpoint),
    scopes_supported: textsOf(record.scopes_supported),
    claims_supported: textsOf(record.claims_supported),
    code_challenge_methods_supported: textsOf(record.code_challenge_methods_supported),
  };
}

/** Never rejects: a provider that cannot be reached is a result, not a crash. */
export type DiscoveryResult =
  | {
      readonly ok: true;
      readonly url: string;
      readonly document: Discovery;
      /** `connection` when the connection names its own endpoints, so nothing was fetched. */
      readonly source: "discovery" | "connection";
    }
  | { readonly ok: false; readonly url: string; readonly reason: string };

/** What one HTTP exchange came back with, after any redirects. */
export type HttpResponse = {
  readonly status: number;
  /** Where the exchange ended up, after redirects. */
  readonly url: string;
  readonly body: string;
};

/**
 * What a provider's answer to a probe says about the connection. `unknown` is
 * for an answer the provider's profile does not recognise: it must never be
 * read as `accepted`, or a provider changing its error page would make the
 * check pass silently.
 */
export type Verdict =
  | { readonly kind: "accepted" }
  | { readonly kind: "unknown" }
  | {
      readonly kind: "rejected";
      readonly problem: "client" | "redirect_uri";
      readonly reason: string;
    };

/**
 * How one provider words its refusals. Providers differ here, so the knowledge
 * lives with the provider and a provider without a profile gets no probes.
 */
export interface ProviderProbes {
  /** The provider's answer to an authorization request made without a user. */
  authorize(response: HttpResponse): Verdict;
}

export type SignInPhase =
  | "ceremony_started"
  | "callback_received"
  | "exchange_finished"
  | "resolved"
  | "user_created"
  | "handed_off";

/**
 * One phase of one sign-in attempt, as the runtime reports it. It carries ids
 * and names only: the runtime never logs a code, a token, a secret or a claim
 * value, so there is none to read.
 */
export type SignInEvent = {
  readonly slug: string;
  /** Identifies the attempt. */
  readonly flowId: string;
  /**
   * Whether the event is about an SSO exchange with a named connection, which an
   * attempt's start and handoff, shared by every kind of sign-in, are not.
   */
  readonly sso?: true;
  readonly phase: SignInPhase;
  readonly status: "ok" | "failed";
  readonly reason?: string;
  readonly side?: "provider" | "journey";
  /** When the runtime recorded it. */
  readonly at?: string;
};

/**
 * Everything the live sign-in check touches outside itself: the page to send
 * the developer to, the runtime's events, a way to open a browser and the
 * clock. A test hands it fakes for all of them.
 */
export type LiveSignIn = {
  readonly loginUrl: string;
  readonly timeoutMs: number;
  /** Best effort: the URL is printed first, so a failure to open a browser is not an error. */
  readonly open: (url: string) => Promise<void>;
  /** Progress shown while waiting. */
  readonly say: (message: string) => void;
  /**
   * Events from the moment the promise resolves on, until `signal` aborts. It
   * resolves only once what the log already holds has been read, so an attempt
   * made after that is never mistaken for an old one.
   */
  readonly watch: (signal: AbortSignal) => Promise<AsyncIterable<SignInEvent>>;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type IdpContext = {
  /** Every endpoint the connection names itself, by field, so each can be checked as the server does. */
  readonly configuredEndpoints?: Readonly<Record<string, string>>;
  /** Endpoints the connection should name but does not: it names some, and the server refuses a partial set. */
  readonly missingEndpoints?: readonly string[];
  /** Whether the connection reads claims from the ID token, so needs no userinfo endpoint. */
  readonly idTokenMapping?: boolean;
  /** The connection's slug, for messages that point at its file. */
  readonly slug: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  /** The provider's own claim names the connection's mappings read. */
  readonly claims: readonly string[];
  readonly callbackUri: string;
  /**
   * The endpoints the connection names itself, as the server uses them without
   * reading a discovery document; `undefined` when it names none.
   */
  readonly endpoints: { readonly authorization: string } | undefined;
  readonly consoleUrl: string | undefined;
  readonly probes: ProviderProbes | undefined;
  readonly discovery: Promise<DiscoveryResult>;
  readonly request: Send;
  /** Absent when the live sign-in is skipped. */
  readonly live?: LiveSignIn;
};

/** The one way a check reaches the network: a GET that follows redirects. */
export type Send = (url: string) => Promise<HttpResponse>;

/**
 * Build the context for one connection, starting the discovery fetch once so
 * every check that needs the document shares it.
 */
export function idpContext(input: Omit<IdpContext, "discovery">): IdpContext {
  if (input.endpoints !== undefined) {
    return {
      ...input,
      discovery: Promise.resolve({
        ok: true,
        url: input.issuer,
        source: "connection",
        document: {
          authorization_endpoint: input.endpoints.authorization,
        },
      }),
    };
  }
  const url = `${input.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const discovery = input.request(url).then(
    (response): DiscoveryResult => {
      if (response.status !== 200) {
        return { ok: false, url, reason: `${url} answered ${response.status}` };
      }
      try {
        return {
          ok: true,
          url,
          source: "discovery",
          document: discoveryOf(JSON.parse(response.body)),
        };
      } catch {
        return { ok: false, url, reason: `${url} did not return JSON` };
      }
    },
    (error: unknown): DiscoveryResult => ({
      ok: false,
      url,
      reason: `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
    }),
  );
  return { ...input, discovery };
}
