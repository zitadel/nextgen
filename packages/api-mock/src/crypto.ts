/**
 * Ephemeral RSA-2048 key pair for JWT signing in the standalone mock server
 * and MSW handler context.
 *
 * Uses the Web Crypto API (`globalThis.crypto.subtle`) so the module works
 * in both Node.js ≥ 18 and modern browsers without polyfills or bundler
 * shims. The key pair is generated once at module load via top-level await.
 * No keys are committed to the repository — they are fresh on every
 * process/page start.
 *
 * Both the standalone HTTP server and the MSW in-process handlers import
 * from this module, so they share the same ephemeral pair within a single
 * process.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const s = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(s).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
}

function fromBase64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/") + pad), (c) =>
    c.charCodeAt(0),
  );
}

const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

const { privateKey, publicKey } = await globalThis.crypto.subtle.generateKey(
  { ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  /* extractable */ true,
  ["sign", "verify"],
);

const rawJwk = await globalThis.crypto.subtle.exportKey("jwk", publicKey);

export const KEY_ID = "mock-key-1";

/** Public JWK for the JWKS endpoint (JsonWebKey + kid, which the DOM type omits). */
export const JWK: JsonWebKey & { kid: string } = {
  ...rawJwk,
  kid: KEY_ID,
  use: "sig",
  alg: "RS256",
};

async function buildJwt(header: object, payload: object): Promise<string> {
  const h = toBase64url(enc.encode(JSON.stringify(header)));
  const p = toBase64url(enc.encode(JSON.stringify(payload)));
  const signing = `${h}.${p}`;
  const sig = toBase64url(
    await globalThis.crypto.subtle.sign(ALG.name, privateKey, enc.encode(signing)),
  );
  return `${signing}.${sig}`;
}

/**
 * Discriminated error for handoff-token verification failures. Lets the
 * `/sessions/exchange` handler map distinct failure modes to distinct HTTP
 * status codes per the OpenAPI contract:
 *   - `expired`   → 410 Gone (also used for replays of an already-consumed
 *                   token; both surface the same status to the client)
 *   - everything else → 401 Unauthorized
 */
export type HandoffErrorKind =
  | "structure"
  | "algorithm"
  | "signature"
  | "audience"
  | "issuer"
  | "expired"
  | "not_yet_valid";

export class HandoffError extends Error {
  constructor(
    public readonly kind: HandoffErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HandoffError";
  }
}

/**
 * Signs a short-lived handoff token (60 s, aud=exchange) suitable for
 * `POST /sessions/exchange`. Includes a random `jti` so the consumer can
 * enforce single-use semantics.
 */
export async function signHandoffToken(claims: { sub: string; iss: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return buildJwt(
    { alg: "RS256", typ: "JWT", kid: KEY_ID },
    {
      ...claims,
      aud: "exchange",
      iat: now,
      nbf: now,
      exp: now + 60,
      jti: toBase64url(globalThis.crypto.getRandomValues(new Uint8Array(16))),
    },
  );
}

/**
 * Signs a long-lived session token (1 h) suitable for the
 * `__nextgen_session` HttpOnly cookie.
 */
export async function signSessionToken(claims: {
  sub: string;
  email: string;
  iss: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return buildJwt(
    { alg: "RS256", typ: "JWT", kid: KEY_ID },
    { ...claims, iat: now, nbf: now, exp: now + 3600 },
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
export async function verifyHandoffToken(
  token: string,
  { expectedIss }: { expectedIss?: string } = {},
): Promise<{ sub: string; iss: string; jti?: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HandoffError("structure", "invalid token structure");
  }
  const [h, p, s] = parts as [string, string, string];

  // Validate algorithm before touching the signature — defence against alg:none attacks.
  const header = JSON.parse(dec.decode(fromBase64url(h))) as { alg?: string };
  if (header.alg !== "RS256") {
    throw new HandoffError("algorithm", `unsupported algorithm: ${header.alg ?? "none"}`);
  }

  const signing = `${h}.${p}`;
  const ok = await globalThis.crypto.subtle.verify(
    ALG.name,
    publicKey,
    new Uint8Array(fromBase64url(s)),
    enc.encode(signing),
  );
  if (!ok) {
    throw new HandoffError("signature", "invalid signature");
  }

  const payload = JSON.parse(dec.decode(fromBase64url(p))) as {
    sub: string;
    iss: string;
    aud: string;
    exp: number;
    nbf?: number;
    jti?: string;
  };
  if (payload.aud !== "exchange") {
    throw new HandoffError("audience", "wrong audience");
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new HandoffError("expired", "token expired");
  }
  if (payload.nbf !== undefined && payload.nbf > Math.floor(Date.now() / 1000)) {
    throw new HandoffError("not_yet_valid", "token not yet valid");
  }
  if (expectedIss !== undefined && payload.iss !== expectedIss) {
    throw new HandoffError("issuer", `wrong issuer: expected ${expectedIss}, got ${payload.iss}`);
  }
  return { sub: payload.sub, iss: payload.iss, jti: payload.jti };
}

/**
 * Decodes a session token issued by `signSessionToken` without re-verifying
 * the signature. The mock is a single process — it only ever sees tokens it
 * signed itself, so a full cryptographic verify is unnecessary overhead.
 *
 * @param token - Raw JWT string from the `__nextgen_session` cookie.
 * @returns The decoded claims, or `null` when the token is malformed.
 */
export function decodeSessionToken(
  token: string,
): { sub: string; email: string; iss: string; iat: number; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(dec.decode(fromBase64url(parts[1]!)));
    if (!payload.sub || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

