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

import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ISSUER = "http://issuer.test";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_KEY_JWK = publicKey.export({
  type: "spki",
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
});

describe("auth()", () => {
  it("returns unauthenticated when the x-nextgen-auth-token header is absent", async () => {
    const auth = await importAuth();
    expect(await auth({ url: ISSUER })).toEqual({ isAuthenticated: false, session: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unauthenticated for the middleware's empty-string tunnel value", async () => {
    mockHeadersMap.set("x-nextgen-auth-token", "");
    const auth = await importAuth();
    expect(await auth({ url: ISSUER })).toEqual({ isAuthenticated: false, session: null });
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
    const result = await auth({ url: ISSUER });

    expect(result).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("failed JWT verification"));
  });

  it("accepts a correctly signed JWT and maps its claims", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    const token = makeSignedJwt(
      { sub: "user-abc", email: "alice@example.com", name: "Alice", iss: ISSUER, exp: ts(3600) },
      kid,
    );
    mockHeadersMap.set("x-nextgen-auth-token", token);

    const auth = await importAuth();
    const result = await auth({ url: ISSUER });

    expect(result).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-abc",
        email: "alice@example.com",
        name: "Alice",
        token,
      },
    });
  });

  it("nulls email and name when the signed JWT omits them", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeSignedJwt({ sub: "user-xyz", iss: ISSUER, exp: ts(3600) }, kid),
    );

    const auth = await importAuth();
    const result = await auth({ url: ISSUER });

    expect(result.isAuthenticated).toBe(true);
    if (result.isAuthenticated) {
      expect(result.session.email).toBeNull();
      expect(result.session.name).toBeNull();
    }
  });

  it("rejects a correctly signed JWT without a sub claim", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeSignedJwt({ email: "nosub@example.com", iss: ISSUER, exp: ts(3600) }, kid),
    );

    const auth = await importAuth();
    // Must NOT fall through to the opaque path and come back authenticated.
    expect(await auth({ url: ISSUER })).toEqual({ isAuthenticated: false, session: null });
  });

  it("rejects an expired signed JWT", async () => {
    const kid = nextKid();
    routeFetch(kid, () => jsonResponse({}, 500));
    mockHeadersMap.set(
      "x-nextgen-auth-token",
      makeSignedJwt({ sub: "user-late", iss: ISSUER, exp: ts(-3600) }, kid),
    );

    const auth = await importAuth();
    expect(await auth({ url: ISSUER })).toEqual({ isAuthenticated: false, session: null });
  });

  // ── Opaque path: backend validation, not blind trust ─────────────────

  it("rejects a random opaque header value the backend does not know", async () => {
    routeFetch(nextKid(), () => jsonResponse({ error: "unauthenticated" }, 401));
    mockHeadersMap.set("x-nextgen-auth-token", "attacker-supplied-junk");

    const auth = await importAuth();
    const result = await auth({ url: ISSUER });

    expect(result).toEqual({ isAuthenticated: false, session: null });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ISSUER}/sessions/me`,
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
        email: "bob@example.com",
        name: "Bob",
      }),
    );
    const token = makeJweShapedToken();
    mockHeadersMap.set("x-nextgen-auth-token", token);

    const auth = await importAuth();
    const result = await auth({ url: ISSUER });

    // Identity comes from the backend response — no more userId "unknown".
    expect(result).toEqual({
      isAuthenticated: true,
      session: { userId: "user-1", email: "bob@example.com", name: "Bob", token },
    });
  });

  it("treats an anonymous session (no user_id) as signed out", async () => {
    routeFetch(nextKid(), () =>
      jsonResponse({ session_id: "sess-2", project_id: "proj-1", state: "active" }),
    );
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth({ url: ISSUER })).toEqual({ isAuthenticated: false, session: null });
  });

  it("fails closed and warns on unexpected backend statuses", async () => {
    routeFetch(nextKid(), () => jsonResponse({ error: "boom" }, 500));
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth({ url: ISSUER })).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));
  });

  it("fails closed and warns when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    mockHeadersMap.set("x-nextgen-auth-token", makeJweShapedToken());

    const auth = await importAuth();
    expect(await auth({ url: ISSUER })).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("could not reach"));
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
    const result = await auth({ url: ISSUER, opaqueTokenTimeoutMs: 5 });

    expect(result).toEqual({ isAuthenticated: false, session: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("could not reach"));
  });

  it("falls back to the ZITADEL_URL environment variable for the backend URL", async () => {
    vi.stubEnv("ZITADEL_URL", ISSUER);
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
    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/sessions/me`, expect.anything());
  });
});
