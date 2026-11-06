import type { CreateFlow201Step } from "@zitadel/api/generated/model";

type Challenge = NonNullable<CreateFlow201Step["gates"][string]["challenge"]>;

/**
 * Throws an `AbortError` once `signal` is aborted. `AbortSignal.throwIfAborted`
 * needs Chrome 100 and Safari 15.4, newer than the widget's other needs.
 */
export function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("The signup check was stopped.", "AbortError");
}

/**
 * Solve the `signup_pow` gate of a password sign-up step, as `<zitadel-login>`
 * does, for a client of your own: GET the step, pass `step.gates.signup_pow.challenge`,
 * and submit the result as `gate_proofs.signup_pow`. Needs `crypto.subtle`,
 * which browsers offer only on `https://` and `localhost` pages.
 */
export async function solveSignupPow(challenge: Challenge, signal?: AbortSignal): Promise<string> {
  // Web Crypto runs PBKDF2 asynchronously. No worker bundle, WASM, provider
  // script or main-thread password hashing is needed for this fixed profile.
  if (
    challenge.protocol !== "zitadel_pow_poc_v1" ||
    challenge.profile_id !== "pbkdf2_sha256_5000_l1" ||
    !challenge.challenge_id ||
    challenge.challenge_id.length > 256 ||
    !/^[0-9a-f]{32}$/.test(challenge.salt) ||
    !/^[0-9a-f]{32}$/.test(challenge.nonce) ||
    !/^[0-9a-f]{32}$/.test(challenge.key_prefix)
  )
    throw new Error("Unsupported signup challenge. Refresh and try again.");
  if (!globalThis.crypto?.subtle)
    throw new Error("Signup requires a secure browser connection (https:// or localhost).");
  const expires = Date.parse(challenge.expires_at);
  if (!Number.isFinite(expires)) throw new Error("Invalid signup challenge expiry.");
  // Server time decides proof expiry; a device clock may be minutes off.
  const deadline = performance.now() + 30_000;
  const decode = (hex: string) =>
    Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
  const salt = decode(challenge.salt);
  const input = new Uint8Array(20);
  input.set(decode(challenge.nonce));
  const counter = new DataView(input.buffer);
  const prefix = decode(challenge.key_prefix);
  for (let trial = 0; trial < 512; trial++) {
    stopIfAborted(signal);
    if (performance.now() >= deadline) throw new Error("Signup check expired. Please try again.");
    counter.setUint32(16, trial, false);
    const key = await crypto.subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: 5000 },
        key,
        256,
      ),
    );
    stopIfAborted(signal);
    if (performance.now() >= deadline) throw new Error("Signup check expired. Please try again.");
    if (prefix.every((byte, i) => byte === derived[i])) {
      return JSON.stringify({
        protocol: challenge.protocol,
        challenge_id: challenge.challenge_id,
        derived_key: Array.from(derived, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      });
    }
  }
  throw new Error("Signup check could not be solved. Please try again.");
}
