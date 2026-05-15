/**
 * Ephemeral RSA-2048 key pair for JWT signing in the standalone mock server
 * and MSW handler context.
 *
 * The key pair is generated once at module load time using `node:crypto`.
 * No keys are committed to the repository — they are fresh on every process
 * start. Both the standalone HTTP server and the MSW in-process handlers
 * import from this module, so they share the same ephemeral pair within a
 * single process.
 */
import { createSign, createVerify, generateKeyPairSync, type KeyObject } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

export const KEY_ID = "mock-key-1";

/** Public JWK for the JWKS endpoint (JsonWebKey + kid, which the DOM type omits). */
export const JWK: JsonWebKey & { kid: string } = {
  ...(publicKey.export({ format: "jwk" }) as JsonWebKey),
  kid: KEY_ID,
  use: "sig",
  alg: "RS256",
};

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function buildJwt(header: object, payload: object): string {
  const h = base64url(Buffer.from(JSON.stringify(header)));
  const p = base64url(Buffer.from(JSON.stringify(payload)));
  const signing = `${h}.${p}`;
  const sig = base64url(
    createSign("SHA256").update(signing).sign(privateKey as KeyObject),
  );
  return `${signing}.${sig}`;
}

/**
 * Signs a short-lived handoff token (60 s, aud=exchange) suitable for
 * `POST /sessions/exchange`.
 */
export function signHandoffToken(claims: { sub: string; iss: string }): string {
  const now = Math.floor(Date.now() / 1000);
  return buildJwt(
    { alg: "RS256", typ: "JWT", kid: KEY_ID },
    { ...claims, aud: "exchange", iat: now, exp: now + 60 },
  );
}

/**
 * Signs a long-lived session token (1 h) suitable for the
 * `__nextgen_session` HttpOnly cookie.
 */
export function signSessionToken(claims: {
  sub: string;
  email: string;
  iss: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  return buildJwt(
    { alg: "RS256", typ: "JWT", kid: KEY_ID },
    { ...claims, iat: now, exp: now + 3600 },
  );
}

/**
 * Verifies a handoff token issued by `signHandoffToken`.
 * Throws if the signature is invalid, the token is expired, the audience is
 * wrong, or (when `expectedIss` is supplied) the issuer does not match.
 *
 * @param token       - Raw JWT string.
 * @param expectedIss - When provided, the `iss` claim must equal this value.
 */
export function verifyHandoffToken(
  token: string,
  { expectedIss }: { expectedIss?: string } = {},
): { sub: string; iss: string } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid token structure");
  const [h, p, s] = parts as [string, string, string];
  const signing = `${h}.${p}`;
  const sig = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const ok = createVerify("SHA256")
    .update(signing)
    .verify(publicKey as KeyObject, sig);
  if (!ok) throw new Error("invalid signature");
  const payload = JSON.parse(Buffer.from(p, "base64").toString()) as {
    sub: string;
    iss: string;
    aud: string;
    exp: number;
  };
  if (payload.aud !== "exchange") throw new Error("wrong audience");
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("token expired");
  if (expectedIss !== undefined && payload.iss !== expectedIss) {
    throw new Error(`wrong issuer: expected ${expectedIss}, got ${payload.iss}`);
  }
  return { sub: payload.sub, iss: payload.iss };
}
