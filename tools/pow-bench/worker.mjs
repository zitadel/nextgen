import { sha256 } from "@noble/hashes/sha2.js";
import { solveChallenge } from "altcha-lib";
import { deriveKey as pbkdf2 } from "altcha-lib/algorithms/web/pbkdf2";
import { deriveKey as webSHA } from "altcha-lib/algorithms/web/sha";

const encoder = new TextEncoder();
const domain = encoder.encode("zitadel:pow:1:");
function meets(hash, bits) {
  for (const byte of hash) {
    const zeros = byte === 0 ? 8 : Math.clz32(byte) - 24;
    if (zeros >= bits) return true;
    if (zeros < 8) return false;
    bits -= 8;
  }
  return bits <= 0;
}
function ownInput(ticket) {
  const input = new Uint8Array(domain.length + 32 + 8);
  input.set(domain);
  input.set(sha256(encoder.encode(ticket)), domain.length);
  return input;
}
async function solve(candidate, challenge, variant) {
  if (!candidate.own) {
    // Public deriveKey extension point; same SHA-256 framing as the official adapter.
    const nobleSHA = async (_parameters, salt, password) => {
      const input = new Uint8Array(salt.length + password.length);
      input.set(salt);
      input.set(password, salt.length);
      return { derivedKey: sha256(input) };
    };
    const deriveKey = candidate.cost === 1 ? (variant === "webcrypto" ? webSHA : nobleSHA) : pbkdf2;
    const proof = await solveChallenge({ challenge, deriveKey, timeout: 90_000 });
    if (!proof) throw new Error("ALTCHA solve timed out");
    return proof;
  }
  const input = ownInput(challenge.ticket);
  const view = new DataView(input.buffer);
  const start = performance.now();
  // Number loop avoids a BigInt operation per trial, but writes all 64 bits.
  for (let counter = 0; counter <= Number.MAX_SAFE_INTEGER; counter++) {
    view.setUint32(input.length - 8, Math.floor(counter / 2 ** 32), false);
    view.setUint32(input.length - 4, counter >>> 0, false);
    if (meets(sha256(input), challenge.difficulty_bits)) return { counter: String(counter) };
    if (counter % 16384 === 0 && performance.now() - start > 90_000)
      throw new Error("Own solver timed out");
  }
  throw new Error("Worker search range exhausted");
}
self.onmessage = async ({ data }) => {
  try {
    if (data.vector) {
      const input = ownInput("fixture-ticket");
      new DataView(input.buffer).setBigUint64(input.length - 8, 0x0102030405060708n, false);
      self.postMessage({
        digest: Array.from(sha256(input), (b) => b.toString(16).padStart(2, "0")).join(""),
      });
      return;
    }
    if (data.altcha_vector) {
      const vector = data.altcha_vector;
      const fromHex = (value) =>
        Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
      const nonce = fromHex(vector.parameters.nonce);
      const password = new Uint8Array(nonce.length + 4);
      password.set(nonce);
      new DataView(password.buffer).setUint32(nonce.length, vector.counter, false);
      const { derivedKey } = await pbkdf2(
        vector.parameters,
        fromHex(vector.parameters.salt),
        password,
      );
      self.postMessage({
        derived_key: Array.from(derivedKey, (b) => b.toString(16).padStart(2, "0")).join(""),
      });
      return;
    }
    const start = performance.now();
    const proof = await solve(data.candidate, data.challenge, data.variant);
    self.postMessage({ proof, ms: performance.now() - start });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
self.postMessage({ ready: true });
