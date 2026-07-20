/**
 * Mock Altcha proof-of-work challenge generator and verifier.
 *
 * Generates a valid Altcha challenge with a known solution so `<zl-captcha>`
 * can solve it trivially in development: `max_number` stays low (1000) and
 * the solution is a small number, so the brute-force loop completes in
 * milliseconds on any device.
 *
 * Proofs travel as strings per `flow-submit-request.yaml` — for Altcha
 * that's the base64-encoded JSON solution payload the widget standard uses:
 * `btoa(JSON.stringify({ algorithm, challenge, number, salt }))`.
 *
 * Uses the Web Crypto API (`globalThis.crypto.subtle`) — works in Node.js
 * ≥ 18 and browsers without polyfills.
 */

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type AltchaChallenge = {
  algorithm: string;
  challenge: string;
  salt: string;
  max_number: number;
};

/**
 * Generate a fresh Altcha PoW challenge. The solution is always within
 * `[0, maxNumber]` so it can be brute-forced quickly in dev.
 *
 * @param solutionNumber - The number that solves the challenge (default: 42).
 *   Keep this low for fast dev-mode solving.
 * @param maxNumber - Upper bound advertised to the solver (default: 1000).
 */
export async function generateAltchaChallenge(
  solutionNumber = 42,
  maxNumber = 1000,
): Promise<AltchaChallenge> {
  const salt = bufferToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const algorithm = "SHA-256";

  // challenge = hex(SHA-256(salt + solutionNumber))
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + solutionNumber);
  const hashBuffer = await globalThis.crypto.subtle.digest(algorithm, data);
  const challenge = bufferToHex(hashBuffer);

  return {
    algorithm,
    challenge,
    salt,
    max_number: maxNumber,
  };
}

/**
 * Verify an Altcha proof string against the originally issued challenge.
 *
 * Decodes the base64 JSON payload, checks the salt matches the issued
 * challenge, and recomputes `SHA-256(salt + number)`. Returns `false` for
 * malformed payloads rather than throwing — a garbled proof is just an
 * invalid one.
 */
export async function verifyAltchaProof(
  original: AltchaChallenge,
  proof: string,
): Promise<boolean> {
  let payload: { number?: unknown; salt?: unknown };
  try {
    payload = JSON.parse(globalThis.atob(proof)) as { number?: unknown; salt?: unknown };
  } catch {
    return false;
  }

  const { number, salt } = payload;
  if (typeof number !== "number" || typeof salt !== "string") return false;
  if (salt !== original.salt) return false;

  const encoder = new TextEncoder();
  const data = encoder.encode(salt + number);
  const hashBuffer = await globalThis.crypto.subtle.digest(original.algorithm, data);

  return bufferToHex(hashBuffer) === original.challenge;
}
