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
 * | `alg` | Signing algorithm (`RS256`, `ES256`, …) | ✅ Checked against {@link VerifyJwtOptions.allowedAlgorithms} before JWKS is fetched |
 * | `kid` | Key ID — selects the matching public key from the JWKS | ✅ Used for key lookup; falls back to the first JWKS key when absent |
 * | `typ` | Token type (`JWT`, `at+JWT`, …) | ✅ Checked against {@link VerifyJwtOptions.allowedTokenTypes} (case-insensitive) |
 * | ~~`enc`~~ | ~~Encryption algorithm — present in JWE (encrypted) tokens only~~ | ~~Not applicable — we verify JWS (signed) tokens, not JWE (encrypted)~~ |
 * | ~~`cty`~~ | ~~Content type — describes the secured content media type~~ | ~~Not applicable — not set by standard OIDC/OAuth auth servers~~ |
 *
 * ---
 *
 * ## JWT Payload claims
 *
 * The payload is a JSON object Base64URL-encoded into the second segment.
 *
 * ### ✅ Validated claims
 *
 * | Claim | Purpose | How |
 * |-------|---------|-----|
 * | `iss` | Issuer — the URL of the auth server that issued the token | Must equal {@link VerifyJwtOptions.issuerUrl} when present in the token |
 * | `exp` | Expiration time — Unix timestamp after which the token is invalid | Must be in the future, allowing {@link VerifyJwtOptions.clockSkewMs} tolerance |
 * | `nbf` | Not before — Unix timestamp before which the token must not be accepted | Must be in the past, allowing {@link VerifyJwtOptions.clockSkewMs} tolerance |
 * | `iat` | Issued at — Unix timestamp when the token was created | Must not be in the future beyond {@link VerifyJwtOptions.clockSkewMs} |
 * | `aud` | Audience — the intended recipient(s) of the token | Checked against {@link VerifyJwtOptions.audience} when that option is provided |
 *
 * ### 📖 Read-only claims (extracted into the session, not further validated)
 *
 * | Claim | Purpose |
 * |-------|---------|
 * | `sub` | Subject — the user's unique identifier |
 * | `email` | User's email address |
 * | `name` | User's display name |
 *
 * ### ❌ Not validated
 *
 * | Claim | Purpose | Why skipped |
 * |-------|---------|-------------|
 * | ~~`jti`~~ | ~~JWT ID — a unique identifier for this specific token instance~~ | ~~Revocation requires a server-side blocklist; not feasible in stateless middleware~~ |
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
 * keyed by `kid` (or `"__default__"` when `kid` is absent), for
 * {@link JWKS_TTL_MS} milliseconds (default 5 minutes).
 *
 * A cache miss — on first use or after TTL expiry — triggers a fresh fetch
 * from `{issuerUrl}/oauth/v2/keys`.
 *
 * > **Note (serverless):** the cache is module-level. In serverless environments
 * > each cold start gets a fresh cache; warm instances share it across requests.
 *
 * ---
 *
 * ## Runtime note
 *
 * This file targets the **Nuxt/Nitro Node.js runtime**.
 * `base64UrlDecode` uses `Buffer.from(input, "base64url")` which natively handles
 * the Base64URL alphabet without character substitution or padding.
 * The equivalent Next.js file (`sdk-next/src/lib/jwt.ts`) uses `atob` instead —
 * that is the only difference between the two.
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
 * The decoded, unverified parts of a compact-serialised JWT.
 *
 * **Do not act on these values before signature verification.**
 * This type is returned by {@link decodeJwt} purely to carry the
 * raw data into the next step.
 */
export interface DecodedJwt {
  readonly header: Readonly<Record<string, unknown>>;
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
   * 1. Determines the JWKS endpoint: `{issuerUrl}/oauth/v2/keys`
   * 2. Is compared against the `iss` claim when present in the token.
   */
  readonly issuerUrl: string;

  /**
   * Restrict accepted `alg` header values. Tokens whose algorithm is not in
   * this list are rejected before the JWKS is fetched.
   * When `undefined`, all algorithms are accepted (not recommended for production).
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
}

// ─── JWKS cache ───────────────────────────────────────────────────────────────

/**
 * In-memory JWKS key cache, keyed by `kid`
 * (or the sentinel `"__default__"` when `kid` is absent).
 *
 * Cache entries are immutable once written; the cache itself grows up to one
 * entry per distinct `kid` seen in the lifetime of the process.
 */
const jwksCache = new Map<string, JwksCacheEntry>();

// ─── Base64URL ────────────────────────────────────────────────────────────────

/**
 * Decodes a Base64URL-encoded string into a `Uint8Array`.
 *
 * Uses Node.js's built-in `Buffer` which natively handles the Base64URL
 * alphabet, removing the need for manual character substitution or padding.
 *
 * @param input - A Base64URL-encoded string (padding is optional).
 * @returns The decoded bytes.
 */
export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(input, "base64url"));
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
 */
export function decodeJwt(token: string): DecodedJwt {
  const [h, p] = token.split(".");
  const decoder = new TextDecoder();
  return {
    header: JSON.parse(decoder.decode(base64UrlDecode(h))) as Record<string, unknown>,
    payload: JSON.parse(decoder.decode(base64UrlDecode(p))) as JwtPayload,
  };
}

// ─── Algorithm helpers ────────────────────────────────────────────────────────

/**
 * Maps a JWT `alg` value to the Web Crypto `AlgorithmIdentifier` used when
 * **importing** a public key from the JWKS (`crypto.subtle.importKey`).
 *
 * @param alg - JWT algorithm string (e.g. `"RS256"`, `"ES256"`).
 */
function resolveImportAlgorithm(alg: string): RsaHashedImportParams | EcKeyImportParams {
  if (alg === "ES256") {
    return { name: "ECDSA", namedCurve: "P-256" };
  }
  return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
}

/**
 * Maps a JWT `alg` value to the Web Crypto `AlgorithmIdentifier` used when
 * **verifying** a signature (`crypto.subtle.verify`).
 *
 * @param alg - JWT algorithm string (e.g. `"RS256"`, `"ES256"`).
 */
function resolveVerifyAlgorithm(alg: string): EcdsaParams | Algorithm {
  if (alg === "ES256") {
    return { name: "ECDSA", hash: "SHA-256" };
  }
  return { name: "RSASSA-PKCS1-v1_5" };
}

// ─── JWKS fetch ───────────────────────────────────────────────────────────────

/**
 * Fetches the JWKS from `jwksUri`, imports the key matching `kid`, and caches
 * it for {@link JWKS_TTL_MS} milliseconds.
 *
 * Behaviour:
 * - When the cached entry for `kid` is still within TTL, it is returned
 *   immediately with no network request.
 * - When `kid` is absent, the first key in the JWKS is used and cached under
 *   the sentinel key `"__default__"`.
 * - Returns `null` when the JWKS endpoint returns a non-OK status, no matching
 *   key is found, or key import fails.
 *
 * @param jwksUri - Full URL of the JWKS endpoint.
 * @param kid     - The `kid` header value from the JWT, or `undefined`.
 */
async function fetchAndCacheJwks(
  jwksUri: string,
  kid: string | undefined,
): Promise<CryptoKey | null> {
  const cacheKey = kid ?? "__default__";
  const cached = jwksCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.key;
  }

  const res = await fetch(jwksUri);
  if (!res.ok) {
    return null;
  }

  const json = (await res.json()) as { keys: (JsonWebKey & { kid?: string; alg?: string })[] };
  const jwk = kid ? json.keys.find((k) => k.kid === kid) : json.keys[0];
  if (!jwk) {
    return null;
  }

  const alg = (jwk.alg as string | undefined) ?? "RS256";
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    resolveImportAlgorithm(alg),
    false,
    ["verify"],
  );

  jwksCache.set(cacheKey, { key: cryptoKey, fetchedAt: Date.now() });
  return cryptoKey;
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verifies a compact-serialised JWT and returns its validated payload.
 *
 * ## Verification steps (in order)
 *
 * 1. Decode header and payload — no trust is established at this point.
 * 2. Reject if `alg` is not in {@link VerifyJwtOptions.allowedAlgorithms} (when set).
 * 3. Reject if `typ` is not in {@link VerifyJwtOptions.allowedTokenTypes} (when non-empty).
 * 4. Fetch (or retrieve from cache) the matching public key from the JWKS endpoint.
 * 5. Verify the cryptographic signature over `header.payload`.
 * 6. Reject if `iss` is present and does not equal {@link VerifyJwtOptions.issuerUrl}.
 * 7. Reject if {@link VerifyJwtOptions.audience} is set and `aud` does not contain it.
 * 8. Reject if `exp` is in the past (minus clock-skew tolerance).
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
export async function verifyJwt(
  token: string,
  opts: VerifyJwtOptions,
): Promise<JwtPayload | null> {
  try {
    const { issuerUrl, allowedAlgorithms, clockSkewMs, audience, allowedTokenTypes } = opts;
    const { header, payload } = decodeJwt(token);

    // ── Step 2: algorithm check ──────────────────────────────────────────────
    const alg = (header.alg as string | undefined) ?? "RS256";
    if (allowedAlgorithms && allowedAlgorithms.length > 0 && !allowedAlgorithms.includes(alg)) {
      return null;
    }

    // ── Step 3: token type check ─────────────────────────────────────────────
    if (allowedTokenTypes.length > 0) {
      const typ = (header.typ as string | undefined) ?? "";
      if (!allowedTokenTypes.some((t) => t.toLowerCase() === typ.toLowerCase())) {
        return null;
      }
    }

    // ── Step 4: JWKS key fetch ───────────────────────────────────────────────
    const kid = header.kid as string | undefined;
    const cryptoKey = await fetchAndCacheJwks(`${issuerUrl}/oauth/v2/keys`, kid);
    if (!cryptoKey) {
      return null;
    }

    // ── Step 5: signature verification ──────────────────────────────────────
    const [h, p, sig] = token.split(".");
    const valid = await crypto.subtle.verify(
      resolveVerifyAlgorithm(alg),
      cryptoKey,
      base64UrlDecode(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!valid) {
      return null;
    }

    // ── Step 6: issuer check ─────────────────────────────────────────────────
    if (payload.iss !== undefined && payload.iss !== issuerUrl) {
      return null;
    }

    // ── Step 7: audience check ───────────────────────────────────────────────
    if (audience !== undefined) {
      const audList = Array.isArray(payload.aud)
        ? (payload.aud as readonly string[])
        : [payload.aud as string | undefined];
      const expectedList = Array.isArray(audience) ? audience : [audience];
      if (!expectedList.some((a) => audList.includes(a))) {
        return null;
      }
    }

    // ── Steps 8–10: time-based claim checks ──────────────────────────────────
    const now = Date.now();
    if (payload.exp !== undefined && payload.exp * 1000 < now - clockSkewMs) {
      return null;
    }
    if (payload.nbf !== undefined && payload.nbf * 1000 > now + clockSkewMs) {
      return null;
    }
    if (payload.iat !== undefined && payload.iat * 1000 > now + clockSkewMs) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
