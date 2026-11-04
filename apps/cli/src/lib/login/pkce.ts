import { createHash, randomBytes } from "node:crypto";

/**
 * A PKCE code verifier (RFC 7636 §4.1): 32 random bytes, base64url, which is
 * 43 characters of the unreserved set.
 */
export function newCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** The S256 challenge of a verifier: base64url of its SHA-256, unpadded. */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** An unguessable `state`, which binds the callback to this run. */
export function newState(): string {
  return randomBytes(16).toString("base64url");
}
