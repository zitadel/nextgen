/**
 * Base64URL encoding/decoding for WebAuthn binary fields.
 *
 * WebAuthn's `ArrayBuffer` values (`rawId`, `clientDataJSON`,
 * `authenticatorData`, `signature`, `attestationObject`, `userHandle`)
 * must be base64url-encoded before sending as JSON. The WebAuthn JSON
 * serialization spec (https://www.w3.org/TR/webauthn-3/) requires
 * Base64URL (RFC 4648 §5) — no padding, URL-safe alphabet.
 */

/**
 * Encode an `ArrayBuffer` to a Base64URL string (no padding).
 */
export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decode a Base64URL string to an `ArrayBuffer`.
 */
export function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
