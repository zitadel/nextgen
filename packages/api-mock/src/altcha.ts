/**
 * Mock Altcha proof-of-work challenge generator.
 *
 * Generates a valid Altcha challenge with a known solution so the `<zl-gate>`
 * component can solve it trivially in development. The `max_number` is kept
 * low (1000) and the solution is always a small number so the brute-force
 * loop completes in milliseconds on any device.
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
 * Verify an Altcha proof-of-work solution against the original challenge.
 *
 * Recomputes `SHA-256(salt + number)` and checks it matches `challenge`.
 * Returns `true` if the proof is valid.
 */
export async function verifyAltchaProof(
  original: AltchaChallenge,
  proof: { number: number; salt: string },
): Promise<boolean> {
  if (proof.salt !== original.salt) return false;

  const encoder = new TextEncoder();
  const data = encoder.encode(proof.salt + proof.number);
  const hashBuffer = await globalThis.crypto.subtle.digest(original.algorithm, data);
  const hashHex = bufferToHex(hashBuffer);

  return hashHex === original.challenge;
}
