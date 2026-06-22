/**
 * Sanity tests for the re-exported JWT surface.
 *
 * `src/lib/jwt.ts` re-exports the shared verifier from `@zitadel/sdk-core`,
 * which carries its own exhaustive suite. These cases assert the re-export wiring
 * is intact and the headline behaviours hold so a broken export surfaces here
 * rather than only at runtime. They use only vitest and `node:crypto`.
 */

import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { VerifyJwtOptions } from "../../lib/jwt";

import { base64UrlDecode, decodeJwt, verifyJwt } from "../../lib/jwt";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_KEY_JWK = publicKey.export({ type: "spki", format: "jwk" }) as JsonWebKey;

let kidCounter = 0;
function nextKid(): string {
  return `qwikcity-test-key-${++kidCounter}`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

function mockJwks(kid: string): ReturnType<typeof vi.fn> {
  const jwks = { keys: [{ ...PUBLIC_KEY_JWK, kid, alg: "RS256", use: "sig" }] };
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(jwks), { status: 200 }));
}

function baseOpts(overrides: Partial<VerifyJwtOptions> = {}): VerifyJwtOptions {
  return {
    issuerUrl: "http://localhost:4000",
    clockSkewMs: 0,
    allowedTokenTypes: ["JWT", "at+JWT"],
    ...overrides,
  };
}

function ts(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

describe("re-exported JWT surface", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("base64UrlDecode round-trips binary data", () => {
    const original = Buffer.from([0x00, 0xff, 0x7e, 0x80, 0xab, 0xcd]);
    expect(Buffer.from(base64UrlDecode(b64url(original)))).toEqual(original);
  });

  it("decodeJwt extracts header and payload without verifying", () => {
    const token = makeJwt({ sub: "user-1", email: "a@b.com", exp: ts(3600) }, nextKid());
    const { header, payload } = decodeJwt(token);
    expect(header.alg).toBe("RS256");
    expect(payload.sub).toBe("user-1");
  });

  it("verifyJwt returns the payload for a valid token", async () => {
    const kid = nextKid();
    const token = makeJwt(
      { sub: "user-42", email: "u@example.com", iss: "http://localhost:4000", exp: ts(3600) },
      kid,
    );
    vi.stubGlobal("fetch", mockJwks(kid));

    const payload = await verifyJwt(token, baseOpts());
    expect(payload?.sub).toBe("user-42");
  });

  it("verifyJwt rejects a tampered signature", async () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(3600) }, kid);
    const [h, p] = token.split(".");
    vi.stubGlobal("fetch", mockJwks(kid));

    expect(await verifyJwt(`${h}.${p}.AAAAAAAAAAAAAAAA`, baseOpts())).toBeNull();
  });

  it('verifyJwt rejects alg "none" without fetching JWKS', async () => {
    const token = makeJwt(
      { sub: "u", iss: "http://localhost:4000", exp: ts(3600) },
      nextKid(),
      "none",
    );
    vi.stubGlobal("fetch", vi.fn());

    expect(await verifyJwt(token, baseOpts())).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("verifyJwt rejects an expired token", async () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "u", iss: "http://localhost:4000", exp: ts(-10) }, kid);
    vi.stubGlobal("fetch", mockJwks(kid));

    expect(await verifyJwt(token, baseOpts())).toBeNull();
  });

  it("verifyJwt rejects a mismatched issuer", async () => {
    const kid = nextKid();
    const token = makeJwt({ sub: "u", iss: "http://evil.example.com", exp: ts(3600) }, kid);
    vi.stubGlobal("fetch", mockJwks(kid));

    expect(await verifyJwt(token, baseOpts())).toBeNull();
  });
});
