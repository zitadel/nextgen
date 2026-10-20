import { clearJwksCache, verifyJwt } from "@zitadel/sdk-core/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const encode = (value: object): string =>
  base64url(new TextEncoder().encode(JSON.stringify(value)));

const ISSUER = "http://issuer.test";
const options = {
  issuerUrl: ISSUER,
  clockSkewMs: 0,
  allowedTokenTypes: ["JWT"],
  allowedAlgorithms: ["RS256"],
};

/** Signs a token with a fresh RS256 key and publishes the key as the issuer's JWKS. */
async function signedToken(claims: Record<string, unknown>): Promise<string> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1" }] })),
  );
  const signing = `${encode({ alg: "RS256", typ: "JWT", kid: "k1" })}.${encode(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signing),
  );
  return `${signing}.${base64url(new Uint8Array(signature))}`;
}

describe("the JWT entry in the edge runtime", () => {
  afterEach(() => {
    clearJwksCache();
    vi.unstubAllGlobals();
  });

  it("verifies a token against the issuer's JWKS", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signedToken({ iss: ISSUER, sub: "u1", exp });
    expect(await verifyJwt(token, options)).toMatchObject({ sub: "u1" });
  });

  it("rejects an expired token", async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const token = await signedToken({ iss: ISSUER, sub: "u1", exp });
    expect(await verifyJwt(token, options)).toBeNull();
  });
});
