/**
 * Unit tests for lib/jwt.ts
 *
 * All tests are framework-independent — they use only vitest and Node.js's
 * `node:crypto` module to produce real RSA-signed JWTs. No Next.js or Nuxt
 * primitives are involved.
 *
 * ## JWKS cache isolation
 *
 * `lib/jwt.ts` maintains a module-level JWKS cache keyed by `kid`. To prevent
 * one test's cached key from leaking into another's, every test that exercises
 * JWKS lookup generates a unique `kid` via {@link nextKid}. This keeps each
 * test hermetically isolated without requiring a cache-reset export.
 */

import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { VerifyJwtOptions } from "../../lib/jwt";

import { base64UrlDecode, decodeJwt, isJwtShaped, verifyJwt, JWKS_TTL_MS } from "../../lib/jwt";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_KEY_JWK = publicKey.export({
  type: "spki",
  format: "jwk",
}) as JsonWebKey;

/** Monotonically increasing kid counter — ensures each test gets a fresh cache slot. */
let kidCounter = 0;
function nextKid(): string {
  return `test-key-${++kidCounter}`;
}

/** Produces a Base64URL string from a buffer (test helper, not the production function). */
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Builds a compact-serialised RSA-RS256 JWT signed with {@link PRIVATE_KEY_PEM}.
 *
 * @param payload - The JWT payload claims.
 * @param kid     - The key ID to embed in the header.
 * @param alg     - The algorithm to declare in the header (default `"RS256"`).
 * @param typ     - The token type to declare in the header (default `"JWT"`).
 */
function makeJwt(
  payload: Record<string, unknown>,
  kid: string,
  alg = "RS256",
  typ = "JWT",
): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg, typ, kid })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const signing = `${header}.${body}`;
  const sig = createSign("SHA256").update(signing).sign(PRIVATE_KEY_PEM);
  return `${signing}.${b64url(sig)}`;
}

/**
 * Returns a mocked `fetch` that serves a JWKS containing the shared public key
 * under the given `kid`.
 */
function mockJwks(kid: string): ReturnType<typeof vi.fn> {
  const jwks = { keys: [{ ...PUBLIC_KEY_JWK, kid, alg: "RS256", use: "sig" }] };
  const body = JSON.stringify(jwks);
  return vi.fn().mockImplementation(() => Promise.resolve(new Response(body, { status: 200 })));
}

/** Base options suitable for most tests; override per test as needed. */
function baseOpts(overrides: Partial<VerifyJwtOptions> = {}): VerifyJwtOptions {
  return {
    issuerUrl: "http://localhost:4000",
    clockSkewMs: 0,
    allowedTokenTypes: ["JWT", "at+JWT"],
    ...overrides,
  };
}

/** Unix timestamp `offsetSeconds` seconds from now. */
function ts(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

describe("base64UrlDecode", () => {
  it("decodes a plain ASCII string", () => {
    const encoded = b64url(Buffer.from("hello"));
    const decoded = base64UrlDecode(encoded);
    expect(new TextDecoder().decode(decoded)).toBe("hello");
  });

  it("handles input without padding", () => {
    // "Man" → Base64 "TWFu", no padding needed
    const encoded = "TWFu";
    const decoded = base64UrlDecode(encoded);
    expect(new TextDecoder().decode(decoded)).toBe("Man");
  });

  it("translates - and _ to + and / correctly", () => {
    // Produce a value that contains + and / in standard Base64
    const raw = Buffer.alloc(6, 0xfb); // 0xfb bytes produce + and / in Base64
    const base64url = raw
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const decoded = base64UrlDecode(base64url);
    expect(Buffer.from(decoded)).toEqual(raw);
  });

  it("round-trips arbitrary binary data", () => {
    const original = Buffer.from([0x00, 0xff, 0x7e, 0x80, 0xab, 0xcd]);
    const encoded = b64url(original);
    const decoded = base64UrlDecode(encoded);
    expect(Buffer.from(decoded)).toEqual(original);
  });
});

describe("decodeJwt", () => {
  it("extracts the header alg and kid fields", () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "u1" }, kid);
    const { header } = decodeJwt(token);
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe(kid);
  });

  it("extracts payload claims", () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "user-1", email: "a@b.com", exp: ts(3600) }, kid);
    const { payload } = decodeJwt(token);
    expect(payload.sub).toBe("user-1");
    expect(payload.email).toBe("a@b.com");
  });

  it("does not verify the signature — a tampered token still decodes", () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "u1" }, kid);
    const [h, p] = token.split(".");
    const tampered = `${h}.${p}.invalidsignature`;
    expect(() => decodeJwt(tampered)).not.toThrow();
    const { payload } = decodeJwt(tampered);
    expect(payload.sub).toBe("u1");
  });

  it("throws TypeError for a token with only two segments", () => {
    expect(() => decodeJwt("one.two")).toThrow(TypeError);
  });

  it("throws TypeError for an empty string", () => {
    expect(() => decodeJwt("")).toThrow(TypeError);
  });
});

describe("verifyJwt", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("signature verification", () => {
    it("returns the payload for a valid token", async () => {
      const kid = nextKid();
      const token = makeJwt(
        {
          sub: "user-42",
          email: "u@example.com",
          iss: "http://localhost:4000",
          exp: ts(3600),
        },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      const payload = await verifyJwt(token, baseOpts());
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe("user-42");
      expect(payload?.email).toBe("u@example.com");
    });

    it("returns null when the signature is tampered", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid);
      const [h, p] = token.split(".");
      const tampered = `${h}.${p}.AAAAAAAAAAAAAAAA`;
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(tampered, baseOpts())).toBeNull();
    });

    it("returns null when the payload is tampered", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid);
      const [h, , sig] = token.split(".");
      const evilPayload = b64url(Buffer.from(JSON.stringify({ sub: "evil", exp: ts(3600) })));
      const tampered = `${h}.${evilPayload}.${sig}`;
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(tampered, baseOpts())).toBeNull();
    });

    it("returns null when JWKS fetch returns a non-OK status", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });

    it("returns null when the kid is not present in the JWKS", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid);
      const wrongKid = nextKid();
      vi.stubGlobal("fetch", mockJwks(wrongKid)); // JWKS has a different kid

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });

    it("returns null for a malformed (non-JWT) token string", async () => {
      vi.stubGlobal("fetch", vi.fn());
      expect(await verifyJwt("not.a.jwt.at.all", baseOpts())).toBeNull();
      expect(await verifyJwt("", baseOpts())).toBeNull();
    });
  });

  describe("JWKS caching", () => {
    it("fetches the JWKS only once for repeated calls with the same kid", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid);
      const fetchMock = mockJwks(kid);
      vi.stubGlobal("fetch", fetchMock);

      await verifyJwt(token, baseOpts());
      await verifyJwt(token, baseOpts());
      await verifyJwt(token, baseOpts());

      // JWKS endpoint must have been called exactly once
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns null when the JWKS fetch times out", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid);
      const timeoutError = new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));

      expect(await verifyJwt(token, baseOpts({ jwksTimeoutMs: 100 }))).toBeNull();
    });

    it("logs to console.error when an unexpected error occurs (W-5)", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid);
      const networkError = new TypeError("fetch failed");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await verifyJwt(token, baseOpts());

      expect(result).toBeNull();
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith("[nextgen] verifyJwt unexpected error:", networkError);
    });

    it("uses the default 5-second timeout when jwksTimeoutMs is not set", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid);
      const fetchMock = mockJwks(kid);
      vi.stubGlobal("fetch", fetchMock);

      await verifyJwt(token, baseOpts());

      // Verify fetch was called with an AbortSignal (the timeout signal)
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init?.signal).toBeDefined();
    });

    it("re-fetches after the TTL window elapses", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid);
      const fetchMock = mockJwks(kid);
      vi.stubGlobal("fetch", fetchMock);

      await verifyJwt(token, baseOpts());

      // Advance time past the cache TTL
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + JWKS_TTL_MS + 1);

      await verifyJwt(token, baseOpts());

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("alg validation", () => {
    it("accepts a token whose alg is in allowedAlgorithms", async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", exp: ts(3600) },
        kid,
        "RS256",
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      const payload = await verifyJwt(token, baseOpts({ allowedAlgorithms: ["RS256"] }));
      expect(payload).not.toBeNull();
    });

    it("rejects a token whose alg is not in allowedAlgorithms", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid, "RS256");
      vi.stubGlobal("fetch", vi.fn()); // fetch must not be called

      const payload = await verifyJwt(token, baseOpts({ allowedAlgorithms: ["ES256"] }));
      expect(payload).toBeNull();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("accepts any alg when allowedAlgorithms is undefined", async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", exp: ts(3600) },
        kid,
        "RS256",
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      const payload = await verifyJwt(token, baseOpts({ allowedAlgorithms: undefined }));
      expect(payload).not.toBeNull();
    });

    it("rejects a token with no alg in the header", async () => {
      const kid = nextKid();
      // Build a properly-signed RS256 token whose header omits 'alg'.
      // Without the fix, this defaults to RS256 and passes verification.
      // With the fix, the missing 'alg' is rejected immediately.
      const rawHeader = b64url(Buffer.from(JSON.stringify({ typ: "JWT", kid })));
      const rawPayload = b64url(Buffer.from(JSON.stringify({ sub: "u", exp: ts(3600) })));
      const signing = `${rawHeader}.${rawPayload}`;
      const sig = b64url(createSign("SHA256").update(signing).sign(PRIVATE_KEY_PEM));
      const token = `${signing}.${sig}`;
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });

    it('rejects alg "none" when allowedAlgorithms is not configured', async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid, "none");
      vi.stubGlobal("fetch", vi.fn());

      expect(await verifyJwt(token, baseOpts({ allowedAlgorithms: undefined }))).toBeNull();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('rejects alg "none" when allowedAlgorithms is an empty array', async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid, "none");
      vi.stubGlobal("fetch", vi.fn());

      expect(await verifyJwt(token, baseOpts({ allowedAlgorithms: [] }))).toBeNull();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('rejects alg "none" even when "none" is in the allowedAlgorithms list', async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid, "none");
      vi.stubGlobal("fetch", vi.fn());

      expect(await verifyJwt(token, baseOpts({ allowedAlgorithms: ["none", "RS256"] }))).toBeNull();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('rejects alg "None" (mixed-case) without calling JWKS (W-3)', async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid, "None");
      vi.stubGlobal("fetch", vi.fn());

      expect(await verifyJwt(token, baseOpts())).toBeNull();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('rejects alg "NONE" (upper-case) without calling JWKS (W-3)', async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid, "NONE");
      vi.stubGlobal("fetch", vi.fn());

      expect(await verifyJwt(token, baseOpts())).toBeNull();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  describe("typ validation", () => {
    it('accepts a token with typ "JWT"', async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", exp: ts(3600) },
        kid,
        "RS256",
        "JWT",
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(
        await verifyJwt(token, baseOpts({ allowedTokenTypes: ["JWT", "at+JWT"] })),
      ).not.toBeNull();
    });

    it('accepts a token with typ "at+JWT"', async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", exp: ts(3600) },
        kid,
        "RS256",
        "at+JWT",
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(
        await verifyJwt(token, baseOpts({ allowedTokenTypes: ["JWT", "at+JWT"] })),
      ).not.toBeNull();
    });

    it("is case-insensitive", async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", exp: ts(3600) },
        kid,
        "RS256",
        "jwt",
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts({ allowedTokenTypes: ["JWT"] }))).not.toBeNull();
    });

    it("rejects a token with an unknown typ", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid, "RS256", "refresh+JWT");
      vi.stubGlobal("fetch", vi.fn());

      expect(await verifyJwt(token, baseOpts({ allowedTokenTypes: ["JWT", "at+JWT"] }))).toBeNull();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("skips typ check when allowedTokenTypes is empty", async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", exp: ts(3600) },
        kid,
        "RS256",
        "anything",
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts({ allowedTokenTypes: [] }))).not.toBeNull();
    });
  });

  describe("iss validation", () => {
    it("accepts a token whose iss matches issuerUrl", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid);
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).not.toBeNull();
    });

    it("rejects a token whose iss does not match issuerUrl", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://evil.example.com", exp: ts(3600) }, kid);
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });

    it("rejects a token with no iss claim (iss is required)", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid); // no iss
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });
  });

  describe("aud validation", () => {
    it("accepts when aud matches the configured audience string", async () => {
      const kid = nextKid();
      const token = makeJwt(
        {
          sub: "u",
          iss: "http://localhost:4000",
          aud: "my-app",
          exp: ts(3600),
        },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts({ audience: "my-app" }))).not.toBeNull();
    });

    it("accepts when aud array contains the configured audience", async () => {
      const kid = nextKid();
      const token = makeJwt(
        {
          sub: "u",
          iss: "http://localhost:4000",
          aud: ["my-app", "other-app"],
          exp: ts(3600),
        },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts({ audience: "my-app" }))).not.toBeNull();
    });

    it("accepts when audience option is an array and one value matches", async () => {
      const kid = nextKid();
      const token = makeJwt(
        {
          sub: "u",
          iss: "http://localhost:4000",
          aud: "my-app",
          exp: ts(3600),
        },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(
        await verifyJwt(token, baseOpts({ audience: ["my-app", "other-app"] })),
      ).not.toBeNull();
    });

    it("rejects when aud does not match the configured audience", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", aud: "wrong-app", exp: ts(3600) }, kid);
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts({ audience: "my-app" }))).toBeNull();
    });

    it("skips aud check when audience option is not set", async () => {
      const kid = nextKid();
      // Token has aud claim but no audience option configured
      const token = makeJwt(
        {
          sub: "u",
          iss: "http://localhost:4000",
          aud: "some-app",
          exp: ts(3600),
        },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts({ audience: undefined }))).not.toBeNull();
    });
  });

  describe("exp validation", () => {
    it("accepts a token that has not yet expired", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid);
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).not.toBeNull();
    });

    it("rejects an expired token", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(-10) }, kid); // expired 10 s ago
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });

    it("accepts a just-expired token within clock skew", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(-3) }, kid); // expired 3 s ago
      vi.stubGlobal("fetch", mockJwks(kid));

      // 5 s clock skew should cover the 3 s expiry
      expect(await verifyJwt(token, baseOpts({ clockSkewMs: 5000 }))).not.toBeNull();
    });

    it("rejects a token with no exp claim (exp is required)", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iss: "http://localhost:4000" }, kid); // no exp
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });
  });

  describe("nbf validation", () => {
    it("accepts a token whose nbf is in the past", async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", nbf: ts(-60), exp: ts(3600) },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).not.toBeNull();
    });

    it("rejects a token whose nbf is in the future", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", nbf: ts(60), exp: ts(3600) }, kid);
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });

    it("accepts a token whose nbf is just in the future but within clock skew", async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", nbf: ts(3), exp: ts(3600) },
        kid,
      ); // nbf 3 s ahead
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts({ clockSkewMs: 5000 }))).not.toBeNull();
    });
  });

  describe("iat validation", () => {
    it("accepts a token with iat in the past", async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", iat: ts(-60), exp: ts(3600) },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).not.toBeNull();
    });

    it("rejects a token with iat in the future", async () => {
      const kid = nextKid();
      const token = makeJwt({ sub: "u", iat: ts(60), exp: ts(3600) }, kid);
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });

    it("accepts a token whose iat is just in the future but within clock skew", async () => {
      const kid = nextKid();
      const token = makeJwt(
        { sub: "u", iss: "http://localhost:4000", iat: ts(3), exp: ts(3600) },
        kid,
      );
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts({ clockSkewMs: 5000 }))).not.toBeNull();
    });
  });

  describe("algorithm support", () => {
    it("returns null for unsupported algorithm in token header", async () => {
      // PS256 is not in IMPORT_PARAMS/VERIFY_PARAMS; the TypeError thrown by
      // assertSupportedAlgorithm is caught inside verifyJwt and returned as null
      // so callers never need to handle errors — only null or a valid payload.
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid, "PS256");
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });

    it("returns null for HS256 (symmetric — no public key support)", async () => {
      // HS256 is not in IMPORT_PARAMS/VERIFY_PARAMS; same catch-and-return-null
      // path as for any other unsupported algorithm.
      const kid = nextKid();
      const token = makeJwt({ sub: "u", exp: ts(3600) }, kid, "HS256");
      vi.stubGlobal("fetch", mockJwks(kid));

      expect(await verifyJwt(token, baseOpts())).toBeNull();
    });
  });
});

describe("isJwtShaped", () => {
  function header(obj: Record<string, unknown>): string {
    return b64url(Buffer.from(JSON.stringify(obj)));
  }

  it("recognises a signed JWT (JWS) — alg present, no enc", () => {
    expect(isJwtShaped(`${header({ alg: "RS256", typ: "JWT" })}.payload.sig`)).toBe(true);
  });

  it("recognises a real signed token", () => {
    expect(isJwtShaped(makeJwt({ sub: "u1" }, nextKid()))).toBe(true);
  });

  it("rejects a JWE token — header carries both alg and enc", () => {
    const jweHeader = header({ alg: "A256GCMKW", enc: "A256GCM" });
    expect(isJwtShaped(`${jweHeader}.enckey.iv.ciphertext.tag`)).toBe(false);
  });

  it("rejects opaque strings without three dot-separated segments", () => {
    expect(isJwtShaped("opaque-session-token")).toBe(false);
    expect(isJwtShaped("two.parts")).toBe(false);
    expect(isJwtShaped("")).toBe(false);
  });

  it("rejects tokens with an empty first segment", () => {
    expect(isJwtShaped(".payload.sig")).toBe(false);
  });

  it("rejects tokens whose header is not Base64URL JSON", () => {
    expect(isJwtShaped("not-base64-json!!.payload.sig")).toBe(false);
  });

  it("rejects tokens whose header has no string alg", () => {
    expect(isJwtShaped(`${header({ typ: "JWT" })}.payload.sig`)).toBe(false);
    expect(isJwtShaped(`${header({ alg: 42 })}.payload.sig`)).toBe(false);
  });
});
