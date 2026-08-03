/**
 * @file lib/jwt.ts
 *
 * # JWT Verification
 *
 * Stateless JWT verification via JWKS, with in-process key caching.
 *
 * ## Anatomy of a JWT
 *
 * A compact JWT (JWS compact serialisation) is three Base64URL-encoded parts
 * joined by dots:
 *
 * ```
 * <header>.<payload>.<signature>
 * ```
 *
 * - **Header** — metadata about the token: signing algorithm, key ID, token type.
 * - **Payload** — the claims: user identity, expiry, issuer, audience, etc.
 * - **Signature** — `SIGN(privateKey, "<header>.<payload>")`. Any party with the
 *   matching public key can verify it without contacting the auth server.
 *
 * A valid signature proves two things:
 *
 * 1. **Authenticity** — the token was produced by the holder of the private key.
 * 2. **Integrity** — neither the header nor the payload has been altered since signing.
 *
 * Signature verification alone is not sufficient. The claims inside the payload
 * must also be checked (expiry, issuer, audience, …). Both steps are performed
 * by {@link verifyJwt}.
 *
 * ---
 *
 * ## JWT Header fields
 *
 * The header is a JSON object Base64URL-encoded into the first segment.
 *
 * | Field | Purpose | Verified |
 * |-------|---------|---------|
 * | `alg` | Signing algorithm (`RS256`, `ES256`, …) | Checked against {@link VerifyJwtOptions.allowedAlgorithms} before JWKS is fetched |
 * | `kid` | Key ID — selects the matching public key from the JWKS | Used for key lookup; falls back to the first JWKS key when absent |
 * | `typ` | Token type (`JWT`, `at+JWT`, …) | Checked against {@link VerifyJwtOptions.allowedTokenTypes} (case-insensitive) |
 * | ~~`enc`~~ | ~~Encryption algorithm — present in JWE (encrypted) tokens only~~ | ~~Not applicable — we verify JWS (signed) tokens, not JWE (encrypted)~~ |
 * | ~~`cty`~~ | ~~Content type — describes the secured content media type~~ | ~~Not applicable — not set by standard OIDC/OAuth auth servers~~ |
 *
 * ---
 *
 * ## JWT Payload claims
 *
 * The payload is a JSON object Base64URL-encoded into the second segment.
 *
 * ### Validated claims
 *
 * | Claim | Purpose | How |
 * |-------|---------|-----|
 * | `iss` | Issuer — the URL of the auth server that issued the token | Must be present and must equal {@link VerifyJwtOptions.issuerUrl} |
 * | `exp` | Expiration time — Unix timestamp after which the token is invalid | Must be present and in the future, allowing {@link VerifyJwtOptions.clockSkewMs} tolerance |
 * | `nbf` | Not before — Unix timestamp before which the token must not be accepted | Must be in the past, allowing {@link VerifyJwtOptions.clockSkewMs} tolerance |
 * | `iat` | Issued at — Unix timestamp when the token was created | Must not be in the future beyond {@link VerifyJwtOptions.clockSkewMs} |
 * | `aud` | Audience — the intended recipient(s) of the token | Checked against {@link VerifyJwtOptions.audience} when that option is provided |
 *
 * ### Read-only claims (extracted into the session, not further validated)
 *
 * | Claim | Purpose |
 * |-------|---------|
 * | `sub` | Subject — the user's unique identifier |
 * | `email` | User's email address |
 * | `name` | User's display name |
 *
 * ### Not validated
 *
 * | Claim | Purpose | Why skipped |
 * |-------|---------|-------------|
 * | ~~`jti`~~ | ~~JWT ID — a unique identifier for this specific token instance~~ | ~~Revocation requires a server-side blocklist; not feasible in stateless edge middleware~~ |
 * | ~~`azp`~~ | ~~Authorized party — the OAuth 2.0 client that requested the token~~ | ~~The proxy architecture means the browser never contacts the auth server directly, making cross-origin token replay a non-threat~~ |
 * | ~~`nonce`~~ | ~~OIDC nonce — binds a token to a specific authorisation request~~ | ~~Not applicable in our password/cookie flow (no OIDC redirect round-trip)~~ |
 * | ~~`acr`~~ | ~~Authentication class reference — describes the strength of the authentication~~ | ~~Not validated (future: require MFA for sensitive routes)~~ |
 * | ~~`amr`~~ | ~~Authentication methods reference — list of methods used to authenticate~~ | ~~Not validated~~ |
 * | ~~`scope`~~ | ~~OAuth 2.0 scopes granted to the token~~ | ~~Not validated (future: per-route scope enforcement)~~ |
 *
 * ---
 *
 * ## JWKS caching
 *
 * Public keys are expensive to fetch and import. They are cached in-process,
 * keyed by `"${jwksUri}:${kid}"` (or `"${jwksUri}:__default__"` when `kid` is
 * absent), for {@link JWKS_TTL_MS} milliseconds (default 5 minutes).
 *
 * Including the full JWKS URI in the cache key prevents a key imported for one
 * issuer from being mistakenly served when a different issuer happens to use the
 * same `kid` string — a scenario that can arise in multi-tenant deployments or
 * during key-rotation incidents where two servers briefly share a key identifier.
 *
 * A cache miss — on first use or after TTL expiry — triggers a fresh fetch
 * from `{issuerUrl}/auth/keys`.
 *
 * > **Note (serverless):** the cache is module-level. In serverless environments
 * > each cold start gets a fresh cache; warm instances share it across requests.
 *
 * ---
 *
 * ## Runtime note
 *
 * This file is the **shared implementation** used by both `sdk-next` (Edge
 * runtime) and `sdk-nuxt` (Node.js/Nitro). `base64UrlDecode` uses `atob`,
 * which is available in both environments (Edge natively; Node.js since v16).
 * The previous per-SDK copies (one using `atob`, one using `Buffer`) have
 * been consolidated here.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** How long a cached JWKS key is considered fresh before re-fetching. */
export const JWKS_TTL_MS = 5 * 60 * 1_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The subset of standard JWT payload claims this module reads or validates.
 *
 * All fields are `readonly`. Additional custom claims are preserved under
 * the index signature and accessible via `payload["my-claim"]`.
 *
 * Refer to the module-level documentation for the full verification matrix.
 */
export interface JwtPayload {
  /** Issuer (`iss`) — identifies the auth server that created the token. */
  readonly iss?: string;
  /** Subject (`sub`) — the user's unique identifier. */
  readonly sub?: string;
  /**
   * Audience (`aud`) — the intended recipient(s).
   * A single string or an array of strings per RFC 7519 §4.1.3.
   */
  readonly aud?: string | readonly string[];
  /** Expiration time (`exp`) — seconds since Unix epoch. */
  readonly exp?: number;
  /** Not before (`nbf`) — seconds since Unix epoch. */
  readonly nbf?: number;
  /** Issued at (`iat`) — seconds since Unix epoch. */
  readonly iat?: number;
  /** User's email address (custom claim). */
  readonly email?: string;
  /** User's display name (custom claim). */
  readonly name?: string;
  readonly [key: string]: unknown;
}

/**
 * The typed representation of a JWT header.
 *
 * The three fields below are the only ones this library reads. Additional
 * header parameters are preserved under the index signature.
 */
export interface JwtHeader {
  /** Signing algorithm (`alg`) — e.g. `"RS256"`, `"ES256"`. */
  readonly alg?: string;
  /** Token type (`typ`) — e.g. `"JWT"`, `"at+JWT"`. */
  readonly typ?: string;
  /** Key ID (`kid`) — selects the matching public key from the JWKS. */
  readonly kid?: string;
  readonly [key: string]: unknown;
}

/**
 * The decoded, unverified parts of a compact-serialised JWT.
 *
 * **Do not act on these values before signature verification.**
 * This type is returned by {@link decodeJwt} purely to carry the
 * raw data into the next step.
 */
export interface DecodedJwt {
  readonly header: JwtHeader;
  readonly payload: JwtPayload;
}

/**
 * A single entry in the in-process JWKS key cache.
 * Immutable once written — the cache map stores new entries but never mutates
 * existing ones.
 */
interface JwksCacheEntry {
  readonly key: CryptoKey;
  readonly fetchedAt: number;
}

/**
 * Options for {@link verifyJwt}.
 *
 * All fields are `readonly` — this object is never mutated after construction.
 */
export interface VerifyJwtOptions {
  /**
   * Base URL of the auth backend.
   *
   * Serves two purposes:
   * 1. Determines the JWKS endpoint: `{issuerUrl}/auth/keys`
   * 2. Is compared against the `iss` claim when present in the token.
   */
  readonly issuerUrl: string;

  /**
   * Restrict accepted `alg` header values. Tokens whose algorithm is not in
   * this list are rejected before the JWKS is fetched.
   * When `undefined`, all algorithms are accepted (the middleware layer
   * defaults to `["RS256", "ES256"]` before passing options here).
   */
  readonly allowedAlgorithms?: readonly string[];

  /**
   * Clock-skew tolerance in milliseconds, applied symmetrically to `exp`,
   * `nbf`, and `iat` checks to accommodate minor differences between clocks.
   */
  readonly clockSkewMs: number;

  /**
   * Expected `aud` claim value(s). When `undefined`, audience is not
   * validated. Provide a string or array when the auth server sets `aud`
   * and you want to ensure the token was issued specifically for your app.
   */
  readonly audience?: string | readonly string[];

  /**
   * Accepted `typ` header values (case-insensitive).
   *
   * Guards against using a refresh token or ID token where an access token
   * is expected. Set to an empty array (`[]`) to disable this check.
   *
   * @default ["JWT", "at+JWT"]
   */
  readonly allowedTokenTypes: readonly string[];

  /**
   * Timeout in milliseconds for JWKS endpoint requests.
   * Requests that do not complete within this window are aborted and the
   * token is rejected (function returns `null`).
   * @default 5000
   */
  readonly jwksTimeoutMs?: number;
}

// ─── JWKS cache ───────────────────────────────────────────────────────────────

/**
 * In-memory JWKS key cache.
 *
 * Keys are of the form `"${jwksUri}:${kid}"`, or `"${jwksUri}:__default__"`
 * when the JWT carries no `kid`. Including the full JWKS URI prevents a cached
 * key from one issuer being returned for a request targeting a different issuer
 * that happens to share the same `kid` string — a scenario that can arise in
 * multi-tenant deployments or during key-rotation incidents.
 *
 * Cache entries are immutable once written; the cache itself grows up to one
 * entry per distinct `(jwksUri, kid)` pair seen in the lifetime of the process.
 *
 * The cache is intentionally unbounded. In practice the number of distinct
 * (jwksUri, kid) pairs is bounded by the number of key rotations during the
 * process lifetime — typically a handful. A bounded LRU eviction policy could
 * be added if memory growth becomes a concern for very long-lived processes
 * with frequent key rotations, but is omitted here to keep the implementation
 * dependency-free.
 */
const jwksCache = new Map<string, JwksCacheEntry>();

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

// ─── Base64URL ────────────────────────────────────────────────────────────────

/**
 * Decodes a Base64URL-encoded string into a `Uint8Array`.
 *
 * The Edge runtime has no `Buffer`, so this uses `atob` after translating the
 * Base64URL alphabet (`-` → `+`, `_` → `/`) and padding to a multiple of four.
 *
 * @param input - A Base64URL-encoded string (padding is optional).
 * @returns The decoded bytes.
 */
export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ─── JWT splitting ────────────────────────────────────────────────────────────

/**
 * Splits a compact JWT string into its three raw Base64URL segments without
 * decoding or verifying any of them.
 *
 * Tokens with more than three segments (e.g. nested JWTs) are accepted; only
 * the first three parts are returned. Tokens with fewer than three segments are
 * structurally invalid compact JWTs and cannot be verified.
 *
 * @param token - The compact JWT string.
 * @returns A `[header, payload, signature]` tuple, or `null` when the token
 *   has fewer than three dot-separated segments.
 */
function splitToken(token: string): readonly [string, string, string] | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) {
    return null;
  }
  return [h, p, s] as const;
}

// ─── JWT decode ───────────────────────────────────────────────────────────────

/**
 * Decodes a compact-serialised JWT into its header and payload **without**
 * verifying the signature.
 *
 * **Do not trust the result of this function alone.** Use it only as the first
 * step of a full verification pipeline — the signature check in {@link verifyJwt}
 * must follow before any claim can be trusted.
 *
 * @param token - A compact JWT string (`header.payload.signature`).
 * @returns The decoded {@link DecodedJwt}.
 * @throws {TypeError} When `token` has fewer than three dot-separated segments.
 */
export function decodeJwt(token: string): DecodedJwt {
  const segments = splitToken(token);
  if (!segments) {
    throw new TypeError(
      `Invalid JWT: expected at least three dot-separated segments, received ${token.split(".").length}.`,
    );
  }
  const [h, p] = segments;
  return {
    header: JSON.parse(DECODER.decode(base64UrlDecode(h))) as JwtHeader,
    payload: JSON.parse(DECODER.decode(base64UrlDecode(p))) as JwtPayload,
  };
}

// ─── JWT shape detection ──────────────────────────────────────────────────────

/**
 * Returns `true` when `token` looks structurally like a signed JWT (JWS) —
 * NOT an encrypted token (JWE).
 *
 * JWS compact: 3 dot-separated segments; header has `alg` but NOT `enc`.
 * JWE compact: 5 dot-separated segments; header has BOTH `alg` and `enc`.
 *
 * The Zitadel backend issues JWE tokens (AES-256-GCM via go-jose
 * `A256GCMKW/A256GCM`), whose compact form is
 * `header.encrypted_key.iv.ciphertext.tag`. The header decodes to JSON with
 * `"alg":"A256GCMKW","enc":"A256GCM"`. Checking for the absence of `enc`
 * correctly identifies signed JWTs without false-positives on JWE tokens.
 *
 * This is a structural check only — not a security check. Use it to route a
 * token to the correct validation path ({@link verifyJwt} for JWS, a backend
 * session lookup for everything else), never to trust one.
 */
export function isJwtShaped(token: string): boolean {
  const parts = token.split(".");
  if (parts.length < 3 || !parts[0]) return false;
  try {
    const header = JSON.parse(DECODER.decode(base64UrlDecode(parts[0]))) as Record<string, unknown>;
    return typeof header?.alg === "string" && !("enc" in header);
  } catch {
    return false;
  }
}

// ─── Algorithm helpers ────────────────────────────────────────────────────────

/**
 * Web Crypto parameters for importing a public key from JWKS, keyed by JWT
 * `alg` header value. The keys of this object are the only supported algorithms;
 * anything not present throws {@link TypeError}.
 */
const IMPORT_PARAMS = {
  RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  RS384: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
  RS512: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
  ES256: { name: "ECDSA", namedCurve: "P-256" },
  ES384: { name: "ECDSA", namedCurve: "P-384" },
  ES512: { name: "ECDSA", namedCurve: "P-521" },
} satisfies Record<string, RsaHashedImportParams | EcKeyImportParams>;

/**
 * Web Crypto parameters for verifying a JWT signature, keyed by JWT `alg`
 * header value.
 */
const VERIFY_PARAMS = {
  RS256: { name: "RSASSA-PKCS1-v1_5" },
  RS384: { name: "RSASSA-PKCS1-v1_5" },
  RS512: { name: "RSASSA-PKCS1-v1_5" },
  ES256: { name: "ECDSA", hash: "SHA-256" },
  ES384: { name: "ECDSA", hash: "SHA-384" },
  ES512: { name: "ECDSA", hash: "SHA-512" },
} satisfies Record<string, EcdsaParams | Algorithm>;

function assertSupportedAlgorithm(alg: string): asserts alg is keyof typeof IMPORT_PARAMS {
  if (!Object.hasOwn(IMPORT_PARAMS, alg)) {
    throw new TypeError(
      `Unsupported JWT algorithm: "${alg}". Supported algorithms are ${Object.keys(IMPORT_PARAMS).join(", ")}.`,
    );
  }
}

function resolveImportAlgorithm(alg: string): RsaHashedImportParams | EcKeyImportParams {
  assertSupportedAlgorithm(alg);
  return IMPORT_PARAMS[alg];
}

function resolveVerifyAlgorithm(alg: string): EcdsaParams | Algorithm {
  assertSupportedAlgorithm(alg);
  return VERIFY_PARAMS[alg];
}

// ─── JWKS fetch ───────────────────────────────────────────────────────────────

/**
 * Fetches the JWKS from `jwksUri`, imports the key matching `kid`, and caches
 * it for {@link JWKS_TTL_MS} milliseconds.
 *
 * The cache key is `"${jwksUri}:${kid ?? '__default__'}"`. Scoping the key to
 * the full endpoint URL ensures that two issuers that happen to publish keys
 * under the same `kid` string are never confused with one another.
 *
 * Behaviour:
 * - When the cached entry for the `(jwksUri, kid)` pair is still within TTL,
 *   it is returned immediately with no network request.
 * - When `kid` is absent, the first key in the JWKS is used and cached under
 *   the `"__default__"` sentinel combined with the endpoint URI.
 * - Returns `null` when the JWKS endpoint returns a non-OK status, no matching
 *   key is found, or key import fails.
 *
 * @param jwksUri - Full URL of the JWKS endpoint.
 * @param kid     - The `kid` header value from the JWT, or `undefined`.
 */
async function fetchAndCacheJwks(
  jwksUri: string,
  kid: string | undefined,
  timeoutMs: number,
): Promise<CryptoKey | null> {
  const cacheKey = `${jwksUri}:${kid ?? "__default__"}`;
  const cached = jwksCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.key;
  }

  const res = await fetch(jwksUri, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    return null;
  }

  interface JwksDocument {
    keys: (JsonWebKey & { kid?: string; alg?: string })[];
  }
  const json = (await res.json()) as JwksDocument;
  const jwk = kid ? json.keys.find((k) => k.kid === kid) : json.keys[0];
  if (!jwk) {
    return null;
  }

  // RFC 7517 §4.4 makes 'alg' optional in a JWK — the key material (kty, n/e
  // for RSA; kty/crv/x/y for EC) determines the key type. Fall back to RS256
  // when absent. The actual algorithm enforcement happens in verifyJwt via the
  // JWT header's 'alg' claim, not here.
  const alg = jwk.alg ?? "RS256";
  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, resolveImportAlgorithm(alg), false, [
    "verify",
  ]);

  jwksCache.set(cacheKey, { key: cryptoKey, fetchedAt: Date.now() });
  return cryptoKey;
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verifies a compact-serialised JWT and returns its validated payload.
 *
 * ## Verification steps (in order)
 *
 * 1. Split the token — returns `null` immediately when fewer than three
 *    dot-separated segments are present.
 * 2. Reject if `alg` is not in {@link VerifyJwtOptions.allowedAlgorithms} (when set).
 * 3. Reject if `typ` is not in {@link VerifyJwtOptions.allowedTokenTypes} (when non-empty).
 * 4. Fetch (or retrieve from cache) the matching public key from the JWKS endpoint.
 * 5. Verify the cryptographic signature over `header.payload`.
 * 6. Reject if `iss` is absent or does not equal {@link VerifyJwtOptions.issuerUrl}.
 * 7. Reject if {@link VerifyJwtOptions.audience} is set and `aud` does not contain it.
 * 8. Reject if `exp` is absent or is in the past (minus clock-skew tolerance).
 * 9. Reject if `nbf` is in the future (plus clock-skew tolerance).
 * 10. Reject if `iat` is in the future (plus clock-skew tolerance).
 *
 * Returns `null` on any failure rather than throwing, so callers can treat a
 * bad token identically to a missing one without try/catch at the call site.
 *
 * @param token - The raw compact-serialised JWT string.
 * @param opts  - Verification options; see {@link VerifyJwtOptions}.
 * @returns The verified {@link JwtPayload}, or `null` if verification fails.
 */
export async function verifyJwt(token: string, opts: VerifyJwtOptions): Promise<JwtPayload | null> {
  try {
    const {
      issuerUrl,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs = 5000,
    } = opts;

    const segments = splitToken(token);
    if (!segments) {
      return null;
    }
    const [rawHeader, rawPayload, rawSig] = segments;

    const header = JSON.parse(DECODER.decode(base64UrlDecode(rawHeader))) as JwtHeader;
    const payload = JSON.parse(DECODER.decode(base64UrlDecode(rawPayload))) as JwtPayload;

    // RFC 7515 §4.1.1 requires 'alg' in the JWT header. A token that omits it
    // is structurally invalid — we reject it rather than guessing an algorithm.
    const alg = header.alg;
    if (!alg) {
      return null;
    }
    // Unconditionally reject the 'none' algorithm regardless of the allowlist.
    // 'none' means the token is unsigned; accepting it would allow anyone to
    // forge arbitrary claims without a key. The comparison is case-insensitive
    // so that "None", "NONE", or any other casing variant is also rejected.
    if (alg.toLowerCase() === "none") {
      return null;
    }
    if (allowedAlgorithms?.length && !allowedAlgorithms.includes(alg)) {
      return null;
    }

    if (allowedTokenTypes.length > 0) {
      const typ = header.typ ?? "";
      if (!allowedTokenTypes.some((t) => t.toLowerCase() === typ.toLowerCase())) {
        return null;
      }
    }

    const kid = header.kid;
    const cryptoKey = await fetchAndCacheJwks(`${issuerUrl}/auth/keys`, kid, jwksTimeoutMs);
    if (!cryptoKey) {
      return null;
    }

    const valid = await crypto.subtle.verify(
      resolveVerifyAlgorithm(alg),
      cryptoKey,
      base64UrlDecode(rawSig),
      ENCODER.encode(`${rawHeader}.${rawPayload}`),
    );
    if (!valid) {
      return null;
    }

    // Strict equality is intentional: the issuer URL must match exactly as
    // configured. We deliberately do not normalise trailing slashes, case, or
    // surrounding whitespace — any difference is either a misconfiguration or
    // a token issued by a different server and must be rejected.
    if (payload.iss !== issuerUrl) {
      return null;
    }

    if (audience !== undefined) {
      const audList = payload.aud !== undefined ? [payload.aud].flat() : [];
      const expectedList = [audience].flat();
      if (!expectedList.some((a) => audList.includes(a))) {
        return null;
      }
    }

    const now = Date.now();
    if (payload.exp === undefined || payload.exp * 1000 < now - clockSkewMs) {
      return null;
    }
    if (payload.nbf !== undefined && payload.nbf * 1000 > now + clockSkewMs) {
      return null;
    }
    if (payload.iat !== undefined && payload.iat * 1000 > now + clockSkewMs) {
      return null;
    }

    return payload;
  } catch (err) {
    // SyntaxError from JSON.parse means the token segments are not JSON —
    // this is an opaque (non-JWT) token. Return null silently; the middleware
    // will fall back to opaque token validation via the backend.
    if (err instanceof SyntaxError) {
      return null;
    }
    // Any other unexpected error (network failure, malformed JWKS, Web Crypto
    // exception) is worth logging so operators can distinguish infrastructure
    // failures from genuine bad tokens.
    console.error("[nextgen] verifyJwt unexpected error:", err);
    return null;
  }
}
