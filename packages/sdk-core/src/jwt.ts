/**
 * Stateless JWT verification through a JWKS, with in-process key caching.
 *
 * ## Anatomy of a JWT
 *
 * A compact JWT, in the JWS compact serialization, is three Base64URL-encoded parts joined by
 * dots:
 *
 * ```
 * <header>.<payload>.<signature>
 * ```
 *
 * - The header holds metadata: the signing algorithm, the key id and the token type.
 * - The payload holds the claims: the user identity, the expiry, the issuer, the audience and so
 *   on.
 * - The signature is `SIGN(privateKey, "<header>.<payload>")`. Any party with the matching public
 *   key can verify it without contacting the auth server.
 *
 * A valid signature proves authenticity, because the holder of the private key produced the token,
 * and integrity, because neither the header nor the payload has changed since signing. A signature
 * alone is not enough: the claims must be checked too, for expiry, issuer and audience.
 * {@link verifyJwt} performs both steps.
 *
 * ## Header fields
 *
 * | Field | Purpose | Verified |
 * |-------|---------|----------|
 * | `alg` | Signing algorithm (`RS256`, `ES256`, and so on) | Checked against {@link VerifyJwtOptions.allowedAlgorithms} before the JWKS is fetched; `none` is always rejected |
 * | `kid` | Key id, which selects the public key from the JWKS | Used for the key lookup; the first key of the JWKS is used when absent |
 * | `typ` | Token type (`JWT`, `at+JWT`) | Checked against {@link VerifyJwtOptions.allowedTokenTypes}, case-insensitively |
 * | `enc` | Encryption algorithm, present in encrypted (JWE) tokens only | Not applicable: only signed (JWS) tokens are verified |
 * | `cty` | Content type of the secured content | Not applicable: standard OIDC and OAuth servers do not set it |
 *
 * ## Payload claims
 *
 * The claims that are validated:
 *
 * | Claim | Purpose | How |
 * |-------|---------|-----|
 * | `iss` | Issuer, the URL of the auth server that issued the token | Must be present and equal {@link VerifyJwtOptions.issuerUrl} |
 * | `exp` | Expiration time, a Unix timestamp | Must be present and in the future, with {@link VerifyJwtOptions.clockSkewMs} tolerance |
 * | `nbf` | Not before, a Unix timestamp | Must be in the past, with {@link VerifyJwtOptions.clockSkewMs} tolerance |
 * | `iat` | Issued at, a Unix timestamp | Must not be in the future beyond {@link VerifyJwtOptions.clockSkewMs} |
 * | `aud` | Audience, the intended recipients | Checked against {@link VerifyJwtOptions.audience} when that option is set |
 *
 * The claims that are read and not validated: `sub` (the user id), `email` and `name`.
 *
 * The claims that are not validated at all: `jti`, because revocation needs a server-side
 * blocklist that stateless edge middleware cannot hold; `azp`, because the proxy architecture means
 * the browser never contacts the auth server directly; `nonce`, because the cookie flow has no
 * OIDC redirect round trip; and `acr`, `amr` and `scope`, which no route enforces yet.
 *
 * ## JWKS caching
 *
 * The whole JWKS document of each issuer is cached in-process, keyed by its JWKS URI, for
 * {@link JWKS_TTL_MS} milliseconds. The keys are imported once and reused. Keying by the URI keeps
 * two issuers that publish the same `kid` apart.
 *
 * The document is fetched from `{issuerUrl}/auth/keys` on first use and after the time to live
 * ends. A token that names a `kid` the cached document lacks refreshes it, which is how a rotated
 * key is picked up, but no sooner than {@link JWKS_MIN_REFRESH_MS} after the last fetch. The `kid`
 * header is attacker-controlled, so a cache per `kid` would let any request with a made-up `kid`
 * cost a JWKS fetch.
 *
 * The cache is module-level. In serverless environments each cold start gets a fresh cache, and
 * warm instances share it across requests.
 *
 * ## Runtimes
 *
 * This module is the shared implementation for the edge runtime and for Node.js. It uses the Web
 * Crypto API, `fetch` and `atob`, so it needs no Node-only dependency.
 *
 * @packageDocumentation
 */

import { joinURL, withoutTrailingSlash } from "ufo";

/**
 * The number of milliseconds a cached JWKS document is considered fresh before it is fetched again.
 *
 * The value is five minutes. It bounds how long a key that the issuer removed or that was
 * compromised keeps verifying, even when the JWKS endpoint is down: an expired document is never
 * used. Call {@link clearJwksCache} to drop a key sooner.
 *
 * @defaultValue 300000
 */
export const JWKS_TTL_MS = 5 * 60 * 1_000;

/**
 * The least number of milliseconds between two JWKS fetches for one issuer.
 *
 * A token that names a `kid` the cached document lacks triggers a refresh, which is how a rotated
 * key is picked up. The refresh happens at most this often, so a stream of tokens with random
 * `kid` values cannot turn every request into a JWKS fetch. A failed fetch counts too, so a
 * failing endpoint is not retried on every request.
 *
 * @defaultValue 30000
 */
export const JWKS_MIN_REFRESH_MS = 30 * 1_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The subset of standard JWT payload claims that this module reads or validates.
 *
 * Every field is `readonly`. Custom claims are preserved under the index signature and reachable
 * as `payload["my-claim"]`, with the type `unknown`. The module documentation lists which claims
 * are validated.
 *
 * @example
 * ```ts
 * const payload = await verifyJwt(token, options);
 * const userId = payload?.sub;
 * ```
 */
export interface JwtPayload {
  /**
   * The issuer (`iss`), which identifies the auth server that created the token.
   *
   * Verification requires it to equal the configured issuer URL.
   */
  readonly iss?: string;
  /**
   * The subject (`sub`), which is the unique identifier of the user.
   */
  readonly sub?: string;
  /**
   * The audience (`aud`), which names the intended recipients.
   *
   * It is a single string or an array of strings, as RFC 7519 allows. For a Zitadel token it
   * carries the project ids that the token was issued for.
   */
  readonly aud?: string | readonly string[];
  /**
   * The expiration time (`exp`), in seconds since the Unix epoch.
   *
   * Verification rejects a token without it.
   */
  readonly exp?: number;
  /**
   * The not-before time (`nbf`), in seconds since the Unix epoch.
   */
  readonly nbf?: number;
  /**
   * The issued-at time (`iat`), in seconds since the Unix epoch.
   */
  readonly iat?: number;
  /**
   * The email address of the user, a custom claim.
   *
   * The session uses it as the login identifier of a JWT-based sign-in.
   */
  readonly email?: string;
  /**
   * The display name of the user, a custom claim.
   */
  readonly name?: string;
  /**
   * Any other claim, with the type `unknown`.
   */
  readonly [key: string]: unknown;
}

/**
 * The typed representation of a JWT header.
 *
 * The three fields below are the only ones that this module reads. Other header parameters are
 * preserved under the index signature.
 */
export interface JwtHeader {
  /**
   * The signing algorithm (`alg`), for example `"RS256"` or `"ES256"`.
   *
   * Verification rejects a token without it, and always rejects `none`.
   */
  readonly alg?: string;
  /**
   * The token type (`typ`), for example `"JWT"` or `"at+JWT"`.
   */
  readonly typ?: string;
  /**
   * The key id (`kid`), which selects the matching public key from the JWKS.
   *
   * When it is absent, verification uses the first key of the JWKS.
   */
  readonly kid?: string;
  /**
   * Any other header parameter, with the type `unknown`.
   */
  readonly [key: string]: unknown;
}

/**
 * The decoded and unverified parts of a compact JWT.
 *
 * Do not act on these values before signature verification: anyone can craft a token with any
 * claims. {@link decodeJwt} returns this type only to carry the raw data into the next step.
 */
export interface DecodedJwt {
  /**
   * The protected header: the algorithm, the key id and the token type that the token claims.
   */
  readonly header: JwtHeader;
  /**
   * The claims.
   *
   * They are unverified, so never trust them until {@link verifyJwt} accepts the token.
   */
  readonly payload: JwtPayload;
}

/**
 * A public key as published in a JWKS document.
 */
type Jwk = JsonWebKey & { readonly kid?: string; readonly alg?: string };

/**
 * The cached JWKS document of one issuer. The whole key set is cached rather
 * than one key per `kid`, so a token naming an unknown `kid` is answered from
 * the cache instead of costing a JWKS fetch.
 */
interface JwksCacheEntry {
  /**
   * The keys of the document.
   */
  readonly keys: readonly Jwk[];
  /**
   * The time of the fetch, in milliseconds since the Unix epoch.
   */
  readonly fetchedAt: number;
  /**
   * The imported keys, by `kid` and algorithm, so that each is imported once.
   */
  readonly imported: Map<string, CryptoKey>;
}

/**
 * The options of {@link verifyJwt}.
 *
 * Every field is `readonly`: the object is never changed after construction. The middleware layer
 * fills the defaults of the optional fields before it passes the options here, so a direct caller
 * decides each field itself.
 *
 * @example
 * ```ts
 * const options: VerifyJwtOptions = {
 *   issuerUrl: "https://auth.example.com",
 *   allowedAlgorithms: ["RS256", "ES256"],
 *   clockSkewMs: 5000,
 *   allowedTokenTypes: ["JWT", "at+JWT"],
 * };
 * ```
 */
export interface VerifyJwtOptions {
  /**
   * The base URL of the auth backend.
   *
   * It serves two purposes. It determines the JWKS endpoint, `{issuerUrl}/auth/keys`, and it is
   * compared with the `iss` claim of the token. The comparison is strict: a trailing slash on the
   * configured address is ignored, but a difference in case or whitespace rejects the token,
   * because it is either a misconfiguration or a token from another server.
   *
   * @example "https://auth.example.com"
   */
  readonly issuerUrl: string;

  /**
   * The accepted values of the `alg` header.
   *
   * A token whose algorithm is not in the list is rejected before the JWKS is fetched. When it is
   * unset or empty, every supported algorithm is accepted, but the `none` algorithm is rejected in
   * all cases. The supported algorithms are `RS256`, `RS384`, `RS512`, `ES256`, `ES384` and
   * `ES512`. The middleware layer defaults to `["RS256", "ES256"]` before it passes the options
   * here.
   *
   * @example ["RS256", "ES256"]
   */
  readonly allowedAlgorithms?: readonly string[];

  /**
   * The clock-skew tolerance in milliseconds.
   *
   * It applies to the `exp`, `nbf` and `iat` checks, so a small difference between the clock of the
   * issuer and the clock of the verifier does not reject a valid token. A larger value accepts an
   * expired token for longer.
   *
   * @example 5000
   */
  readonly clockSkewMs: number;

  /**
   * The expected value or values of the `aud` claim.
   *
   * The token passes when its audience contains at least one of them. When it is unset, the
   * audience is not validated here. Set it to make sure that the token was issued for your app and
   * not for another one on the same issuer.
   *
   * @example "296547382910273"
   */
  readonly audience?: string | readonly string[];

  /**
   * The accepted values of the `typ` header, compared case-insensitively.
   *
   * It guards against the use of another kind of token where an access token is expected. Set it to
   * an empty array to disable the check. A token without a `typ` header counts as an empty string,
   * so it passes only when the check is disabled.
   *
   * @defaultValue ["JWT", "at+JWT"]
   */
  readonly allowedTokenTypes: readonly string[];

  /**
   * The timeout of a JWKS request, in milliseconds.
   *
   * A request that does not complete within the window is aborted, and the token is rejected: the
   * verification returns `null`, so the request counts as signed out.
   *
   * @defaultValue 5000
   */
  readonly jwksTimeoutMs?: number;
}

/**
 * The in-memory JWKS cache, with one document per JWKS URI.
 *
 * Keying by the full URI keeps two issuers that publish the same `kid` apart. It holds one entry
 * per issuer that the process verifies against, each with the keys that the issuer published, so
 * the `kid` values that tokens claim cannot grow it.
 */
const jwksCache = new Map<string, JwksCacheEntry>();

/**
 * The JWKS fetches in flight, by URI, so that concurrent misses share one request.
 */
const jwksInFlight = new Map<string, Promise<JwksCacheEntry | null>>();

/**
 * The time each URI was last fetched, successfully or not.
 *
 * The refresh throttle counts from here and not from the last document, so a failing endpoint is
 * not retried on every request.
 */
const jwksAttemptedAt = new Map<string, number>();

/**
 * The counter that {@link clearJwksCache} bumps.
 *
 * A fetch that started before a clear must not write its answer into the cache or the in-flight
 * table afterwards.
 */
let jwksGeneration = 0;

/**
 * Forgets every cached JWKS document, so that the next verification fetches the key set anew.
 *
 * Use it to drop a compromised key at once instead of waiting out {@link JWKS_TTL_MS}, and in
 * tests that publish different keys per case. A fetch that was already running when it is called
 * does not write its answer into the cache.
 *
 * @example
 * ```ts
 * import { clearJwksCache } from "@zitadel/sdk-core/jwt";
 *
 * afterEach(() => {
 *   clearJwksCache();
 * });
 * ```
 */
export function clearJwksCache(): void {
  jwksGeneration++;
  jwksCache.clear();
  jwksInFlight.clear();
  jwksAttemptedAt.clear();
}

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

/**
 * Decodes a Base64URL-encoded string into bytes.
 *
 * The edge runtime has no `Buffer`, so the function uses `atob` after it translates the Base64URL
 * alphabet, `-` to `+` and `_` to `/`, and pads the input to a multiple of four.
 *
 * @param input - A Base64URL-encoded string. The padding is optional.
 * @returns The decoded bytes.
 * @throws {DOMException} When the input is not valid Base64.
 *
 * @example
 * ```ts
 * new TextDecoder().decode(base64UrlDecode("aGVsbG8")); // "hello"
 * ```
 */
export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Splits a compact JWT string into its three raw Base64URL segments without decoding or verifying
 * any of them.
 *
 * A token with more than three segments is accepted, and only the first three parts are returned.
 * A token with fewer than three segments is not a valid compact JWT and cannot be verified.
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

/**
 * Decodes a compact JWT into its header and payload without verifying the signature.
 *
 * Do not trust the result alone. Use it only as the first step of a full verification pipeline,
 * and use {@link verifyJwt} before any claim is trusted. A legitimate use of the unverified result
 * is to read the `kid` or the `alg` to route the token.
 *
 * @param token - A compact JWT string, `header.payload.signature`.
 * @returns The decoded header and payload.
 * @throws {TypeError} When the token has fewer than three dot-separated segments.
 * @throws {SyntaxError} When the header or the payload is not valid JSON.
 *
 * @example
 * ```ts
 * import { decodeJwt } from "@zitadel/sdk-core/jwt";
 *
 * const { header } = decodeJwt(token);
 * console.log(header.kid);
 * ```
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

/**
 * Returns whether a token looks structurally like a signed JWT, and not like an encrypted token.
 *
 * A signed (JWS) compact token has three dot-separated segments, and its header has `alg` but not
 * `enc`. An encrypted (JWE) compact token has five segments, and its header has both. The Zitadel
 * backend issues encrypted tokens, whose compact form is `header.encrypted_key.iv.ciphertext.tag`
 * and whose header names `A256GCMKW` and `A256GCM`. Checking for the absence of `enc` identifies
 * signed JWTs without a false positive on those tokens.
 *
 * The check is structural and not a security check. Use it to route a token to the right
 * validation path, {@link verifyJwt} for a signed token and a lookup at the backend for everything
 * else. Never use it to trust a token. Any failure to parse the header gives `false`.
 *
 * @param token - The token to inspect.
 * @returns `true` when the token has at least three segments and a header with `alg` and no `enc`.
 *
 * @example
 * ```ts
 * import { isJwtShaped, verifyJwt } from "@zitadel/sdk-core/jwt";
 *
 * const payload = isJwtShaped(token) ? await verifyJwt(token, options) : null;
 * ```
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

/**
 * The Web Crypto parameters for importing a public key from a JWKS, keyed by the `alg` header
 * value.
 *
 * The keys of this object are the only supported algorithms. Anything else is not accepted.
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
 * The Web Crypto parameters for verifying a JWT signature, keyed by the `alg` header value.
 */
const VERIFY_PARAMS = {
  RS256: { name: "RSASSA-PKCS1-v1_5" },
  RS384: { name: "RSASSA-PKCS1-v1_5" },
  RS512: { name: "RSASSA-PKCS1-v1_5" },
  ES256: { name: "ECDSA", hash: "SHA-256" },
  ES384: { name: "ECDSA", hash: "SHA-384" },
  ES512: { name: "ECDSA", hash: "SHA-512" },
} satisfies Record<string, EcdsaParams | Algorithm>;

/**
 * Asserts that an algorithm is supported.
 *
 * @param alg - The `alg` header value.
 * @throws {TypeError} When the algorithm is not supported.
 */
function assertSupportedAlgorithm(alg: string): asserts alg is keyof typeof IMPORT_PARAMS {
  if (!Object.hasOwn(IMPORT_PARAMS, alg)) {
    throw new TypeError(
      `Unsupported JWT algorithm: "${alg}". Supported algorithms are ${Object.keys(IMPORT_PARAMS).join(", ")}.`,
    );
  }
}

/**
 * The JWT `alg` that the curve of an elliptic-curve key signs with, as RFC 7518 defines.
 */
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

/**
 * Returns the Web Crypto verification parameters for an algorithm.
 *
 * @param alg - The `alg` header value.
 * @returns The parameters.
 * @throws {TypeError} When the algorithm is not supported.
 */
function resolveVerifyAlgorithm(alg: string): EcdsaParams | Algorithm {
  assertSupportedAlgorithm(alg);
  return VERIFY_PARAMS[alg];
}

/**
 * Resolves to `null` when a promise has not settled within the timeout.
 *
 * @param promise - The promise to wait for.
 * @param timeoutMs - The timeout in milliseconds.
 * @returns The value of the promise, or `null` after the timeout.
 */
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

/**
 * Returns the key that a token names: the one with its `kid`, or the first key when it has none.
 *
 * @param entry - The cached document.
 * @param kid - The `kid` header value, or `undefined`.
 * @returns The key, or `undefined` when none fits.
 */
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
 * @param jwksUri - The full URL of the JWKS endpoint.
 * @param kid - The `kid` header value from the JWT, or `undefined`.
 * @param alg - The `alg` header value of the token, already checked against the allow list.
 * @param timeoutMs - The timeout of a JWKS request, in milliseconds.
 * @returns The imported key, or `null` when no key fits.
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

/**
 * Verifies a compact JWT and returns its validated payload.
 *
 * The steps run in this order:
 *
 * 1. Split the token. It returns `null` at once when fewer than three dot-separated segments are
 *    present.
 * 2. Reject the token when `alg` is missing, is `none` in any casing, or is not in
 *    {@link VerifyJwtOptions.allowedAlgorithms} when that list is set.
 * 3. Reject the token when `typ` is not in {@link VerifyJwtOptions.allowedTokenTypes} when that
 *    list is not empty.
 * 4. Fetch the matching public key from the JWKS endpoint, or take it from the cache.
 * 5. Verify the signature over `header.payload`.
 * 6. Reject the token when `iss` is absent or does not equal {@link VerifyJwtOptions.issuerUrl}.
 * 7. Reject the token when {@link VerifyJwtOptions.audience} is set and `aud` contains none of
 *    its values.
 * 8. Reject the token when `exp` is absent or in the past, allowing the clock skew.
 * 9. Reject the token when `nbf` is in the future, allowing the clock skew.
 * 10. Reject the token when `iat` is in the future, allowing the clock skew.
 *
 * The function returns `null` on any failure instead of throwing, so a caller treats a bad token
 * the same as a missing one without a try block. A token that is not JSON, such as an opaque
 * session token, returns `null` without a log. An unexpected failure, such as a network error, a
 * malformed JWKS or a Web Crypto error, also returns `null` but is logged to the console, so an
 * operator can tell an infrastructure problem from a bad token.
 *
 * @param token - The raw compact JWT string.
 * @param opts - The verification options.
 * @returns The verified payload, or `null` when verification fails.
 *
 * @example
 * ```ts
 * import { verifyJwt } from "@zitadel/sdk-core/jwt";
 *
 * const payload = await verifyJwt(token, {
 *   issuerUrl: "https://auth.example.com",
 *   clockSkewMs: 5000,
 *   allowedTokenTypes: ["JWT", "at+JWT"],
 * });
 * if (payload) {
 *   console.log(payload.sub);
 * }
 * ```
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
    const cryptoKey = await resolveJwk(joinURL(issuerUrl, "/auth/keys"), kid, alg, jwksTimeoutMs);
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
    // configured, apart from a trailing slash on the configured address, which
    // is not part of an issuer. We deliberately do not normalise case or
    // surrounding whitespace — any difference is either a misconfiguration or
    // a token issued by a different server and must be rejected.
    if (payload.iss !== withoutTrailingSlash(issuerUrl)) {
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
    console.error("[zitadel] verifyJwt unexpected error:", err);
    return null;
  }
}
