import type { CreateFlow201Step } from "@zitadel/api/generated/model";

type Challenge = NonNullable<CreateFlow201Step["gates"][string]["challenge"]>;

// Web Crypto runs PBKDF2 asynchronously. No worker bundle, WASM, provider
// script or main-thread password hashing is needed for this fixed profile.
export async function solveSignupPow(challenge: Challenge, signal: AbortSignal): Promise<string> {
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
  if (!globalThis.crypto?.subtle) throw new Error("Signup requires a secure browser connection.");
  const expires = Date.parse(challenge.expires_at);
  if (!Number.isFinite(expires)) throw new Error("Invalid signup challenge expiry.");
  const deadline = Math.min(expires, Date.now() + 30_000);
  const decode = (hex: string) =>
    Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
  const salt = decode(challenge.salt);
  const input = new Uint8Array(20);
  input.set(decode(challenge.nonce));
  const counter = new DataView(input.buffer);
  const prefix = decode(challenge.key_prefix);
  for (let trial = 0; trial < 512; trial++) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("Signup check expired. Please try again.");
    counter.setUint32(16, trial, false);
    const key = await crypto.subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: 5000 },
        key,
        256,
      ),
    );
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("Signup check expired. Please try again.");
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
