/**
 * Unit tests for auth().
 *
 * auth() reads the `x-nextgen-auth-token` request header and must treat it as
 * **untrusted input**: on routes outside the middleware `matcher` the header
 * arrives straight from the client, so every value is re-verified — JWTs
 * cryptographically (signature via a real RSA key pair and a mocked JWKS
 * endpoint), opaque tokens against a mocked `GET /sessions/me`.
 *
 * The forged-header cases in this file are the regression tests for the
 * header-spoofing vulnerability: a JWT-shaped value with a bogus signature
 * and a random opaque string must both resolve to signed out.
 */

import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ISSUER = "http://issuer.test";

/** The project the app signs its users in to. */
const PROJECT = "proj-1";

/** Another project on the same server. */
const OTHER_PROJECT = "proj-other";

const OPTIONS = { url: ISSUER, projectId: PROJECT };

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_KEY_JWK = publicKey.export({
  format: "jwk",
}) as JsonWebKey;

/** Monotonically increasing kid counter — each test gets a fresh JWKS cache slot. */
let kidCounter = 0;
function nextKid(): string {
  return `auth-test-key-${++kidCounter}`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A compact RS256 JWT signed with the test private key. */
function makeSignedJwt(payload: Record<string, unknown>, kid: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const signing = `${header}.${body}`;
  const sig = createSign("SHA256").update(signing).sign(PRIVATE_KEY_PEM);
  return `${signing}.${b64url(sig)}`;
}

/** A JWT-shaped token whose signature is garbage — what a spoofer would send. */
function makeForgedJwt(payload: Record<string, unknown>, kid: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${header}.${body}.${b64url(Buffer.from("forged-signature"))}`;
}

/** A JWE-shaped token (5 segments, header carries `enc`) — the backend's real format. */
function makeJweShapedToken(): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "A256GCMKW", enc: "A256GCM" })));
  return `${header}.enckey.iv.ciphertext.tag`;
}

/** Unix timestamp `offsetSeconds` seconds from now. */
function ts(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const mockHeadersMap = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => mockHeadersMap.get(name) ?? null,
    }),
  ),
}));

const fetchMock = vi.fn<typeof fetch>();

/**
 * Routes JWKS requests to a key set containing the test public key under
 * `kid`; everything else falls through to `sessionsMe`.
 */
function routeFetch(kid: string, sessionsMe: (url: string) => Response | Promise<Response>) {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === `${ISSUER}/auth/keys`) {
      return Promise.resolve(
        jsonResponse({ keys: [{ ...PUBLIC_KEY_JWK, kid, alg: "RS256", use: "sig" }] }),
      );
    }
    return Promise.resolve(sessionsMe(url));
  });
}

async function importAuth() {
  const { auth } = await import("../auth.js");
  return auth;
}

beforeEach(() => {
  mockHeadersMap.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetConfigForTesting();
});

describe("auth()", () => {
  it("returns unauthenticated when the x-nextgen-auth-token header is absent", async () => {
    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unauthenticated for the middleware's empty-string tunnel value", async () => {
    mockHeadersMap.set("x-nextgen-auth-token", "");
    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── JWT path: verification, not decoding ─────────────────────────────

  it("rejects a forged JWT-shaped header (bogus signature)", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeForgedJwt({ sub: "attacker", iss: ISSUER, exp: ts(3600) }, kid),
    );

    const auth = await importAuth();
    const result = await auth(OPTIONS);

    expect(result).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("failed JWT verification"));
  });

  it("accepts a correctly signed JWT and maps its claims", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    const token = makeSignedJwt(
      {
        sub: "user-abc",
        email: "alice@example.com",
        name: "Alice",
        iss: ISSUER,
        aud: PROJECT,
        exp: ts(3600),
      },
      kid,
    );
    mockHeadersMap.set("x-nextgen-auth-token", token);

    const auth = await importAuth();
    const result = await auth(OPTIONS);

    expect(result).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-abc",
        identifier: "alice@example.com",
        identifierProperty: null,
        display: "Alice",
        token,
      },
    });
  });

  it("nulls identifier and display when the signed JWT omits the claims", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeSignedJwt({ sub: "user-xyz", iss: ISSUER, aud: PROJECT, exp: ts(3600) }, kid),
    );

    const auth = await importAuth();
    const result = await auth(OPTIONS);

    expect(result.isAuthenticated).toBe(true);
    if (result.isAuthenticated) {
      expect(result.session.identifier).toBeNull();
      expect(result.session.display).toBeNull();
    }
  });

  it("rejects a correctly signed JWT without a sub claim", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeSignedJwt({ email: "nosub@example.com", iss: ISSUER, aud: PROJECT, exp: ts(3600) }, kid),
    );

    const auth = await importAuth();
    // Must NOT fall through to the opaque path and come back authenticated.
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
  });

  it("rejects an expired signed JWT", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeSignedJwt({ sub: "user-late", iss: ISSUER, aud: PROJECT, exp: ts(-3600) }, kid),
    );

    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
  });

  // ── Opaque path: backend validation, not blind trust ─────────────────

  it("rejects a random opaque header value the backend does not know", async () => {
    routeFetch(nextKid(), () => jsonResponse({ error: "unauthenticated" }, 401));
    mockHeadersMap.set("x-nextgen-auth-token", "attacker-supplied-junk");

    const auth = await importAuth();
    const result = await auth(OPTIONS);

    expect(result).toEqual({ isAuthenticated: false, session: null });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ISSUER}/sessions/me?project_id=${PROJECT}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: "__nextgen_session=attacker-supplied-junk",
        }),
      }),
    );
  });

  it("authenticates a backend-confirmed opaque token with the real identity", async () => {
    routeFetch(nextKid(), () =>
      jsonResponse({
        session_id: "sess-1",
        project_id: "proj-1",
        state: "active",
        user_id: "user-1",
        user: {
          user_id: "user-1",
          identifier: "bob@example.com",
          identifier_property: "email",
          display: "Bob",
        },
      }),
    );
    const token = makeJweShapedToken();
    mockHeadersMap.set("x-nextgen-auth-token", token);

    const auth = await importAuth();
    const result = await auth(OPTIONS);

    // Identity comes from the backend response — no more userId "unknown".
    expect(result).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-1",
        identifier: "bob@example.com",
        identifierProperty: "email",
        display: "Bob",
        token,
      },
    });
  });

  it("treats an anonymous session (no user_id) as signed out", async () => {
    routeFetch(nextKid(), () =>
      jsonResponse({ session_id: "sess-2", project_id: "proj-1", state: "active" }),
    );
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
  });

  it("fails closed and warns on unexpected backend statuses", async () => {
    routeFetch(nextKid(), () => jsonResponse({ error: "boom" }, 500));
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));
  });

  it("fails closed and warns when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not check the session cookie"),
    );
  });

  it("aborts opaque validation after opaqueTokenTimeoutMs and fails closed", async () => {
    // A fetch that only settles when its AbortSignal fires — proves the
    // timeout option actually reaches the request.
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject((init.signal as AbortSignal).reason as Error),
          );
        }),
    );
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    const result = await auth({ ...OPTIONS, opaqueTokenTimeoutMs: 5 });

    expect(result).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not check the session cookie"),
    );
  });

  it("falls back to the ZITADEL_URL environment variable for the backend URL", async () => {
    vi.stubEnv("ZITADEL_URL", ISSUER);
    vi.stubEnv("ZITADEL_PROJECT_ID", PROJECT);
    routeFetch(nextKid(), () =>
      jsonResponse({
        session_id: "sess-3",
        project_id: "proj-1",
        state: "active",
        user_id: "user-3",
      }),
    );
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    const result = await auth();

    expect(result.isAuthenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `${ISSUER}/sessions/me?project_id=${PROJECT}`,
      expect.anything(),
    );
  });

  // ── Project binding: a session counts only in the app's own project ──

  it("rejects a correctly signed JWT issued for another project", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeSignedJwt({ sub: "user-abc", iss: ISSUER, aud: OTHER_PROJECT, exp: ts(3600) }, kid),
    );

    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
    // Not a forgery: the token verified, it only belongs elsewhere.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("treats a live session of another project as signed out", async () => {
    routeFetch(nextKid(), () =>
      jsonResponse({
        session_id: "sess-4",
        project_id: OTHER_PROJECT,
        state: "active",
        user_id: "user-4",
      }),
    );
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
  });

  it("treats the backend's refusal of another project's session as signed out, quietly", async () => {
    routeFetch(nextKid(), () =>
      jsonResponse({ code: "sess.project_mismatch", message: "different project" }, 403),
    );
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).not.toHaveBeenCalled();
  });

  // Only the server's project-mismatch answer is a quiet "not signed in here";
  // any other 403 (a proxy, a firewall) is a failure worth a log line.
  it("warns on a 403 that is not a project mismatch", async () => {
    routeFetch(nextKid(), () => jsonResponse({ code: "auth.csrf_invalid" }, 403));
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth(OPTIONS)).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
  });

  // A middleware built with createProxy(config) holds sessions to the handle's
  // project; auth() reads it from the same handle when no variable names one.
  it("falls back to the project of configureZitadel()", async () => {
    vi.stubEnv("ZITADEL_PROJECT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_ZITADEL_PROJECT_ID", "");
    configureZitadel({ projectId: PROJECT });
    routeFetch(nextKid(), () =>
      jsonResponse({ session_id: "sess-6", project_id: PROJECT, state: "active", user_id: "u6" }),
    );
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect((await auth({ url: ISSUER })).isAuthenticated).toBe(true);
  });

  it("signs no one in, and says why, when no project is configured", async () => {
    vi.stubEnv("ZITADEL_PROJECT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_ZITADEL_PROJECT_ID", "");
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeSignedJwt({ sub: "user-abc", iss: ISSUER, aud: PROJECT, exp: ts(3600) }, kid),
    );

    const auth = await importAuth();
    expect(await auth({ url: ISSUER })).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no project id"));
  });

  it.each(["ZITADEL_PROJECT_ID", "NEXT_PUBLIC_ZITADEL_PROJECT_ID"])(
    "falls back to the %s environment variable for the project",
    async (variable) => {
      vi.stubEnv("ZITADEL_PROJECT_ID", "");
      vi.stubEnv(variable, PROJECT);
      routeFetch(nextKid(), () =>
        jsonResponse({ session_id: "sess-5", project_id: PROJECT, state: "active", user_id: "u5" }),
      );
      mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

      const auth = await importAuth();
      expect((await auth({ url: ISSUER })).isAuthenticated).toBe(true);
    },
  );
});
