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
 * Each issuer's whole JWKS document is cached in-process, keyed by its JWKS URI,
 * for {@link JWKS_TTL_MS} milliseconds (default 5 minutes); keys are imported
 * once and reused. Keying by the URI keeps two issuers that publish the same
 * `kid` apart.
 *
 * The document is fetched from `{issuerUrl}/auth/keys` on first use and after
 * the TTL. A token naming a `kid` the cached document lacks refreshes it — how
 * a rotated key is picked up — but no sooner than {@link JWKS_MIN_REFRESH_MS}
 * after the last fetch. The `kid` header is attacker-controlled, so a per-`kid`
 * cache would let any request with a made-up `kid` cost a JWKS fetch.
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

/** How long a cached JWKS document is considered fresh before re-fetching. */
export const JWKS_TTL_MS = 5 * 60 * 1_000;

/**
 * The least time between two JWKS fetches for one issuer. A token naming a
 * `kid` the cached document lacks triggers a refresh — that is how a rotated
 * key is picked up — but at most this often, so a stream of tokens with random
 * `kid` values cannot turn every request into a JWKS fetch.
 */
export const JWKS_MIN_REFRESH_MS = 30 * 1_000;

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

/** A public key as published in a JWKS document. */
type Jwk = JsonWebKey & { readonly kid?: string; readonly alg?: string };

/**
 * The cached JWKS document of one issuer. The whole key set is cached rather
 * than one key per `kid`, so a token naming an unknown `kid` is answered from
 * the cache instead of costing a JWKS fetch.
 */
interface JwksCacheEntry {
  readonly keys: readonly Jwk[];
  readonly fetchedAt: number;
  /** Imported keys, by `kid` and algorithm, so each is imported once. */
  readonly imported: Map<string, CryptoKey>;
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
 * In-memory JWKS cache: one document per JWKS URI. Keying by the full URI keeps
 * two issuers that publish the same `kid` apart. It holds one entry per issuer
 * the process verifies against, each with the keys that issuer published, so it
 * cannot be grown by the `kid` values tokens claim.
 */
const jwksCache = new Map<string, JwksCacheEntry>();

/** In-flight JWKS fetches by URI, so concurrent misses share one request. */
const jwksInFlight = new Map<string, Promise<JwksCacheEntry | null>>();

/**
 * When each URI was last fetched, successfully or not. The refresh throttle
 * counts from here, not from the last document, so a failing endpoint is not
 * retried on every request.
 */
const jwksAttemptedAt = new Map<string, number>();

/**
 * Bumped by {@link clearJwksCache}. A fetch that started before a clear must not
 * write its answer into the cache or the in-flight table afterwards.
 */
let jwksGeneration = 0;

/**
 * Forgets every cached JWKS document, so the next verification fetches the key
 * set anew. Use it to drop a compromised key at once instead of waiting out
 * {@link JWKS_TTL_MS}, and in tests that publish different keys per case.
 */
export function clearJwksCache(): void {
  jwksGeneration++;
  jwksCache.clear();
  jwksInFlight.clear();
  jwksAttemptedAt.clear();
}

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

/** The JWT `alg` an EC key's curve signs with (RFC 7518 §3.4). */
const CURVE_ALGORITHMS: Readonly<Record<string, string>> = {
  "P-256": "ES256",
  "P-384": "ES384",
  "P-521": "ES512",
};

/**
 * The Web Crypto import parameters for verifying a token signed with `alg`
 * under `jwk`, or `null` when the key cannot have produced it.
 *
 * RFC 7517 §4.4 makes a JWK's `alg` optional, so the key type decides: an EC
 * key's curve fixes its algorithm, and an RSA key fits any `RS*` algorithm.
 * When the JWK names an `alg`, the token must use that one. A mismatch is a
 * token that cannot verify against this key, not an error worth logging.
 */
function importParams(jwk: Jwk, alg: string): RsaHashedImportParams | EcKeyImportParams | null {
  if (!Object.hasOwn(IMPORT_PARAMS, alg)) {
    return null;
  }
  if (jwk.alg !== undefined && jwk.alg !== alg) {
    return null;
  }
  const fits =
    jwk.kty === "RSA"
      ? alg.startsWith("RS")
      : jwk.kty === "EC" && CURVE_ALGORITHMS[jwk.crv ?? ""] === alg;
  return fits ? IMPORT_PARAMS[alg as keyof typeof IMPORT_PARAMS] : null;
}

function resolveVerifyAlgorithm(alg: string): EcdsaParams | Algorithm {
  assertSupportedAlgorithm(alg);
  return VERIFY_PARAMS[alg];
}

// ─── JWKS fetch ───────────────────────────────────────────────────────────────

/** Resolves to `null` if `promise` has not settled within `timeoutMs`. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Fetches the JWKS document at `jwksUri`, coalescing concurrent fetches, and
 * caches it. Returns `null` when the endpoint fails or answers without a key
 * set, and also, without fetching, when the URI was fetched less than
 * {@link JWKS_MIN_REFRESH_MS} ago: a failed fetch counts, so a failing endpoint
 * is not retried on every request. A failure leaves any previously cached
 * document in place, but {@link resolveJwk} does not use it once it has expired.
 */
function refreshJwks(jwksUri: string, timeoutMs: number): Promise<JwksCacheEntry | null> {
  const pending = jwksInFlight.get(jwksUri);
  if (pending) {
    // The fetch in flight runs on the timeout of whoever started it. A caller
    // that joins it waits no longer than its own.
    return withTimeout(pending, timeoutMs);
  }
  const attemptedAt = jwksAttemptedAt.get(jwksUri);
  if (attemptedAt !== undefined && Date.now() - attemptedAt < JWKS_MIN_REFRESH_MS) {
    return Promise.resolve(null);
  }
  const generation = jwksGeneration;
  jwksAttemptedAt.set(jwksUri, Date.now());
  const request: Promise<JwksCacheEntry | null> = (async () => {
    const res = await fetch(jwksUri, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(json.keys)) {
      return null;
    }
    const entry: JwksCacheEntry = {
      keys: json.keys as Jwk[],
      fetchedAt: Date.now(),
      imported: new Map(),
    };
    if (generation === jwksGeneration) {
      jwksCache.set(jwksUri, entry);
    }
    return entry;
  })().finally(() => {
    // Only the request that is still the registered one is removed: a clear can
    // have replaced it with a newer fetch that must stay shared.
    if (jwksInFlight.get(jwksUri) === request) {
      jwksInFlight.delete(jwksUri);
    }
  });
  jwksInFlight.set(jwksUri, request);
  return request;
}

/** The key a token names: the one with its `kid`, or the first without one. */
function findKey(entry: JwksCacheEntry, kid: string | undefined): Jwk | undefined {
  return kid === undefined ? entry.keys[0] : entry.keys.find((key) => key.kid === kid);
}

/**
 * Resolves the public key for a token from the issuer's JWKS, imported for
 * `alg`.
 *
 * The JWKS document is cached for {@link JWKS_TTL_MS}. A `kid` the cached
 * document lacks refreshes it — a rotated key — but no sooner than
 * {@link JWKS_MIN_REFRESH_MS} after the last fetch, so tokens with made-up
 * `kid` values are answered from the cache. An expired document is never used
 * when its refresh fails. Returns `null` when no key fits: the endpoint failed,
 * no key has that `kid`, or the key cannot verify `alg`.
 *
 * @param jwksUri - Full URL of the JWKS endpoint.
 * @param kid     - The `kid` header value from the JWT, or `undefined`.
 * @param alg     - The token's (already allowlisted) `alg` header value.
 */
async function resolveJwk(
  jwksUri: string,
  kid: string | undefined,
  alg: string,
  timeoutMs: number,
): Promise<CryptoKey | null> {
  const now = Date.now();
  let entry = jwksCache.get(jwksUri);
  if (!entry || now - entry.fetchedAt >= JWKS_TTL_MS) {
    // An expired document is never used: a key the issuer has removed, or one
    // that was compromised, must stop verifying once the TTL has passed even if
    // the endpoint is down.
    entry = (await refreshJwks(jwksUri, timeoutMs)) ?? undefined;
  }
  if (!entry) {
    return null;
  }

  let jwk = findKey(entry, kid);
  if (!jwk && now - entry.fetchedAt >= JWKS_MIN_REFRESH_MS) {
    const refreshed = await refreshJwks(jwksUri, timeoutMs);
    if (refreshed) {
      entry = refreshed;
      jwk = findKey(entry, kid);
    }
  }
  if (!jwk) {
    return null;
  }

  const params = importParams(jwk, alg);
  if (!params) {
    return null;
  }
  const importedKey = `${kid ?? "__default__"}:${alg}`;
  const cached = entry.imported.get(importedKey);
  if (cached) {
    return cached;
  }
  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, params, false, ["verify"]);
  entry.imported.set(importedKey, cryptoKey);
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
    const cryptoKey = await resolveJwk(`${issuerUrl}/auth/keys`, kid, alg, jwksTimeoutMs);
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
