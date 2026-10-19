import {
  completeClaimChallenge,
  resetPlatformStore,
  setupPlatformHandlers,
  snapshotPlatformStore,
} from "@zitadel/api-mock/platform";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

/** What the platform was asked to publish, for a surface the mock does not keep. */
export interface Captured<T> {
  readonly all: T[];
  readonly count: number;
  readonly last: T | undefined;
}

/**
 * How a Google-shaped identity provider answers a connection. Each field
 * defaults to the answer under which the connection works.
 */
export interface ProviderBehaviour {
  /** The issuer the discovery document reports; Google's own unless a spec says otherwise. */
  readonly issuer?: string;
  readonly callbackUri?: "registered" | "unregistered";
  readonly client?: "known" | "unknown";
  readonly secret?: "right" | "wrong";
}

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The cause Google puts in the URL of the error page it ends an authorization request on. */
const refusalPage = (cause: string) =>
  `${GOOGLE_ISSUER}/signin/oauth/error?authError=${Buffer.from(`\n\x10${cause}`).toString("base64url")}`;

/**
 * The mock platform for one spec file, with the arrangements a spec is allowed
 * to make of it. A spec says what the platform should do in its own terms; the
 * HTTP it takes to arrange that stays in here.
 */
export interface PlatformMock {
  /** Makes storing a schema fail, so a command fails partway through. */
  rejectsSchemaUploads(): void;

  /**
   * Answers as a server that is reachable but is not a Zitadel platform API,
   * which is what a mistyped or wrong `--server` points at: every route 404s
   * with a body that is not a platform error envelope.
   */
  isNotZitadel(): void;

  /**
   * Makes every request fail as a platform that is down would: it answers,
   * but with a 503. The CLI maps that to `E_NETWORK`.
   */
  isUnavailable(): void;

  /**
   * Makes every request fail before any response arrives, as a closed port or
   * an unresolvable host would. The CLI maps that to `E_NETWORK` too.
   */
  refusesConnections(): void;

  /**
   * Accepts every request and never answers, as a wedged server or a proxy
   * holding the connection open would; a request settles only when aborted.
   * Resolves once the first request is being held, so a spec can act while
   * the command is waiting.
   */
  hangs(): Promise<void>;

  /** Makes the project's variables unreadable while everything else answers. */
  cannotListVariables(): void;

  /** Makes a stored connection unreadable while everything else answers. */
  cannotReadConnections(): void;

  /** Drops any arranged failure, so the platform answers normally again. */
  recovers(): void;

  /**
   * Completes the claim challenge as soon as `claim` opens one, standing in
   * for the person who would finish it in a browser.
   */
  completesTheNextClaim(): void;

  /**
   * Serves Google as the provider behind the `google` connection: its
   * discovery document, an authorization endpoint and a token endpoint that
   * answer as `behaviour` says.
   */
  hasGoogle(behaviour?: ProviderBehaviour): void;

  /**
   * Serves a plain OpenID provider at `issuer`: a discovery document naming
   * endpoints beneath it, which is all a connection without a known provider
   * is checked against.
   */
  hasOidcProvider(issuer: string): void;

  /** Makes Google unreachable, as a provider that is down or a network that is cut would. */
  googleIsUnreachable(): void;

  /** Records every published branding revision, which the mock does not keep. */
  capturesBrandingPublishes(): Captured<Record<string, unknown>>;
}

/** Starts the mock platform for a spec file and resets it between tests. */
export function usePlatformMock(): PlatformMock {
  const server = setupServer(...setupPlatformHandlers());
  const watchers: NodeJS.Timeout[] = [];

  beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
  afterAll(() => server.close());
  afterEach(() => {
    for (const watcher of watchers.splice(0)) {
      clearInterval(watcher);
    }
    server.resetHandlers();
    resetPlatformStore();
  });

  return {
    rejectsSchemaUploads() {
      server.use(
        http.post("*/schemas", () =>
          HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
        ),
      );
    },

    isNotZitadel() {
      server.use(http.all("*", () => HttpResponse.text("<html>not here</html>", { status: 404 })));
    },

    isUnavailable() {
      server.use(
        http.all("*", () =>
          HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 }),
        ),
      );
    },

    refusesConnections() {
      server.use(http.all("*", () => HttpResponse.error()));
    },

    hangs() {
      return new Promise<void>((waiting) => {
        server.use(
          http.all("*", ({ request }) => {
            waiting();
            return new Promise<never>((_, reject) => {
              request.signal.addEventListener("abort", () => reject(request.signal.reason));
            });
          }),
        );
      });
    },

    cannotListVariables() {
      server.use(
        http.get("*/variables", () =>
          HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
        ),
      );
    },

    cannotReadConnections() {
      server.use(
        http.get("*/idps/:id", () =>
          HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 }),
        ),
      );
    },

    recovers() {
      server.resetHandlers();
    },

    completesTheNextClaim() {
      const watcher = setInterval(() => {
        const { claimChallengeIds, projectIds } = snapshotPlatformStore();
        const challengeId = claimChallengeIds[0];
        const projectId = projectIds[0];
        if (challengeId !== undefined && projectId !== undefined) {
          clearInterval(watcher);
          completeClaimChallenge(challengeId, projectId);
        }
      }, 20);
      watchers.push(watcher);
    },

    hasGoogle({
      callbackUri = "registered",
      client = "known",
      secret = "right",
      issuer = GOOGLE_ISSUER,
    } = {}) {
      const authorizeTo =
        client === "unknown"
          ? refusalPage("invalid_client")
          : callbackUri === "unregistered"
            ? refusalPage("redirect_uri_mismatch")
            : `${GOOGLE_ISSUER}/v3/signin/identifier`;
      server.use(
        http.get(`${GOOGLE_ISSUER}/.well-known/openid-configuration`, () =>
          HttpResponse.json({
            issuer,
            authorization_endpoint: `${GOOGLE_ISSUER}/o/oauth2/v2/auth`,
            token_endpoint: GOOGLE_TOKEN_URL,
            scopes_supported: ["openid", "email", "profile"],
            claims_supported: ["sub", "email", "email_verified", "given_name", "family_name"],
            code_challenge_methods_supported: ["plain", "S256"],
          }),
        ),
        http.get(`${GOOGLE_ISSUER}/o/oauth2/v2/auth`, () =>
          HttpResponse.redirect(authorizeTo, 302),
        ),
        http.get(`${GOOGLE_ISSUER}/v3/signin/identifier`, () => HttpResponse.html("sign in")),
        http.get(`${GOOGLE_ISSUER}/signin/oauth/error`, () => HttpResponse.html("error")),
        http.post(GOOGLE_TOKEN_URL, () =>
          secret === "wrong"
            ? HttpResponse.json(
                {
                  error: "invalid_client",
                  error_description: "The provided client secret is invalid.",
                },
                { status: 401 },
              )
            : HttpResponse.json(
                { error: "invalid_grant", error_description: "Malformed auth code." },
                { status: 400 },
              ),
        ),
      );
    },

    hasOidcProvider(issuer) {
      server.use(
        http.get(`${issuer}/.well-known/openid-configuration`, () =>
          HttpResponse.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            scopes_supported: ["openid", "profile", "email"],
            code_challenge_methods_supported: ["S256"],
          }),
        ),
      );
    },

    googleIsUnreachable() {
      server.use(
        http.all(`${GOOGLE_ISSUER}/*`, () => HttpResponse.error()),
        http.all(GOOGLE_TOKEN_URL, () => HttpResponse.error()),
      );
    },

    capturesBrandingPublishes() {
      const published: Array<Record<string, unknown>> = [];
      server.use(
        http.post("*/branding", async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          published.push(body);
          return HttpResponse.json(
            { id: "brandrev_setup_1", created_at: "2026-08-04T00:00:00.000Z", branding: body },
            { status: 201 },
          );
        }),
        http.get("*/branding/:id", ({ params }) =>
          HttpResponse.json({
            id: params.id,
            created_at: "2026-08-04T00:00:00.000Z",
            branding: published.at(-1) ?? {},
          }),
        ),
      );
      return {
        get all() {
          return published;
        },
        get count() {
          return published.length;
        },
        get last() {
          return published.at(-1);
        },
      };
    },
  };
}
