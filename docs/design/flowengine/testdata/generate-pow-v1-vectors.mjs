// SPDX-License-Identifier: MIT
// Independent reference-vector generator; no production server imports.
// These fixed keys/nonces are public test data and must never be deployed.
import { webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const { subtle } = webcrypto;
const utf8 = (s) => new TextEncoder().encode(s);
const hex = (b) => Buffer.from(b).toString("hex");
const fromHex = (s) => Buffer.from(s, "hex");
const sequence = (start) => Uint8Array.from({ length: 16 }, (_, i) => start + i);
const challengeKey = Uint8Array.from({ length: 32 }, (_, i) => i);
const solutionKey = Uint8Array.from({ length: 32 }, (_, i) => 128 + i);

async function mac(key, domain, ...parts) {
  const hmac = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return hex(await subtle.sign("HMAC", hmac, Buffer.concat([utf8(domain), ...parts])));
}

const vectors = [];
for (const [level, counter] of [
  [1, 0],
  [2, 1023],
  [3, 256],
  [4, 4095],
]) {
  const salt = sequence(16 * level);
  const nonce = sequence(160 + level);
  const input = new Uint8Array(20);
  input.set(nonce);
  new DataView(input.buffer).setUint32(16, counter, false);
  const password = await subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
  const key = new Uint8Array(
    await subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 5000 },
      password,
      256,
    ),
  );
  const context = {
    protocol: "zitadel_pow_v1",
    profile_id: `pbkdf2_sha256_5000_l${level}`,
    project_id: "prj_vector",
    deployment_id: "dpl_vector",
    release_id: "rel_vector",
    policy_revision: level === 1 ? null : "rev_policy",
    config_revision: level === 1 ? null : "rev_config",
    attempt_id: "aat_vector",
    operation: "auth.factor.password.check",
    operation_instance_id: "op_vector",
    requirement_id: "req_vector",
    challenge_id: `chl_vector_${level}`,
    generation: level,
    challenge_key_version: "enc_key_challenge",
    solution_key_version: "enc_key_solution",
    expires_at: 1793631900,
    salt: hex(salt),
    nonce: hex(nonce),
  };
  const contextJSON = JSON.stringify(context);
  const keyMAC = await mac(solutionKey, "zitadel:pow:solution:1:", utf8(contextJSON), key);
  const body = JSON.stringify({ context, key_prefix: hex(key.slice(0, 16)), key_mac: keyMAC });
  vectors.push({
    name: `level_${level}_counter_${counter}`,
    counter,
    challenge_key: hex(challengeKey),
    solution_key: hex(solutionKey),
    context_json: contextJSON,
    body,
    mac: await mac(challengeKey, "zitadel:pow:parameters:1:", utf8(body)),
    derived_key: hex(key),
    proof: JSON.stringify({
      protocol: context.protocol,
      challenge_id: context.challenge_id,
      derived_key: hex(key),
    }),
    public: {
      protocol: context.protocol,
      challenge_id: context.challenge_id,
      profile_id: context.profile_id,
      salt: hex(salt),
      nonce: hex(nonce),
      key_prefix: hex(key.slice(0, 16)),
      expires_at: new Date(context.expires_at * 1000).toISOString().replace(".000Z", "Z"),
    },
  });
}

// Recheck the encoded public projection, independently of the generator's input
// buffers, so this also serves as a native WebCrypto interoperability check.
for (const vector of vectors) {
  const input = new Uint8Array(20);
  input.set(fromHex(vector.public.nonce));
  new DataView(input.buffer).setUint32(16, vector.counter, false);
  const password = await subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
  const key = await subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromHex(vector.public.salt),
      iterations: 5000,
    },
    password,
    256,
  );
  if (hex(key) !== vector.derived_key) throw new Error(`vector mismatch: ${vector.name}`);
}

const destination = new URL("pow-v1-vectors.json", import.meta.url);
const output = `${JSON.stringify(
  {
    license: "MIT",
    description: "Public test keys and puzzle material. Never use in production.",
    vectors,
  },
  null,
  2,
)}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== output) {
    throw new Error("PoW v1 vectors changed; review protocol compatibility before regenerating.");
  }
  console.log("PoW v1: four permanent WebCrypto vectors match.");
} else {
  await writeFile(destination, output);
}
