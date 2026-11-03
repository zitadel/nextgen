import { solveChallenge } from "altcha-lib";
import { deriveKey as libraryPBKDF2 } from "altcha-lib/algorithms/web/pbkdf2";
import { argon2id } from "hash-wasm";

// Peak sum of linear memories instantiated within one KDF call; not process RSS.
// hash-wasm instantiates per call: never retain memories across KDF evaluations.
const memories = [];
let peakWasmBytes = 0;
const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly);
WebAssembly.instantiate = async (...args) => {
  const result = await originalInstantiate(...args);
  const instance = result.instance || result;
  for (const value of Object.values(instance.exports)) {
    if (value instanceof WebAssembly.Memory) memories.push(value);
  }
  return result;
};
const wasmBytes = () => peakWasmBytes;
const fromHex = (hex) => {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2) throw new Error("invalid hex");
  return Uint8Array.from(hex.match(/../g), (byte) => Number.parseInt(byte, 16));
};
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
async function ownPBKDF2(profile, salt, password) {
  const key = await crypto.subtle.importKey("raw", password, { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: profile.cost, hash: "SHA-256" },
      key,
      256,
    ),
  );
}
async function argon(profile, salt, password) {
  memories.length = 0;
  const result = await argon2id({
    password,
    salt,
    iterations: profile.cost,
    memorySize: profile.memory_kib,
    parallelism: 1,
    hashLength: 32,
    outputType: "binary",
  });
  peakWasmBytes = Math.max(
    peakWasmBytes,
    memories.reduce((sum, memory) => sum + memory.buffer.byteLength, 0),
  );
  memories.length = 0;
  return result;
}
function validate(profile) {
  if (!Number.isInteger(profile.trials) || profile.trials < 1 || profile.trials > 4096)
    throw new Error("trial bound");
  if (profile.algorithm === "PBKDF2/SHA-256" && profile.cost === 5000 && profile.memory_kib === 0)
    return;
  if (
    profile.algorithm === "ARGON2ID" &&
    profile.cost === 1 &&
    [4096, 16384, 65536].includes(profile.memory_kib)
  )
    return;
  throw new Error("unsupported fixed profile");
}
async function solve(profile, sample, implementation, budgetMS) {
  validate(profile);
  const start = performance.now();
  const derive = profile.algorithm === "ARGON2ID" ? argon : ownPBKDF2;
  if (implementation === "own") {
    const body = sample.own.body;
    if (body.context.profile_id !== profile.id) throw new Error("profile binding");
    const salt = fromHex(body.context.salt);
    const nonce = fromHex(body.context.nonce);
    const prefix = fromHex(body.key_prefix);
    const password = new Uint8Array(nonce.length + 4);
    password.set(nonce);
    const view = new DataView(password.buffer);
    for (let counter = 0; counter < profile.trials; counter++) {
      if (performance.now() - start > budgetMS) return { timed_out: true, trials: counter };
      view.setUint32(nonce.length, counter, false);
      const key = await derive(profile, salt, password);
      if (prefix.every((b, i) => b === key[i]))
        return { proof: { derived_key: toHex(key) }, trials: counter + 1 };
    }
    throw new Error("bounded search exhausted");
  }
  if (implementation !== "altcha") throw new Error("implementation");
  const parameters = sample.altcha.parameters;
  if (
    parameters.algorithm !== profile.algorithm ||
    parameters.cost !== profile.cost ||
    (parameters.memoryCost || 0) !== profile.memory_kib ||
    parameters.keyLength !== 32 ||
    parameters.parallelism !== 1
  )
    throw new Error("library profile");
  let calls = 0;
  const deriveKey = async (parameters, salt, password) => {
    calls++;
    if (calls > profile.trials) throw new Error("bounded search exhausted");
    return profile.algorithm === "ARGON2ID"
      ? { derivedKey: await argon(profile, salt, password) }
      : libraryPBKDF2(parameters, salt, password);
  };
  const solution = await solveChallenge({ challenge: sample.altcha, deriveKey, timeout: budgetMS });
  if (!solution) return { timed_out: true, trials: calls };
  return { proof: { derived_key: solution.derivedKey }, trials: solution.counter + 1 };
}
self.onmessage = async ({ data }) => {
  try {
    const start = performance.now();
    const result = await solve(
      data.profile,
      data.sample,
      data.implementation,
      data.budget_ms || 30_000,
    );
    self.postMessage({ ...result, ms: performance.now() - start, wasm_linear_bytes: wasmBytes() });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
self.postMessage({ ready: true });
