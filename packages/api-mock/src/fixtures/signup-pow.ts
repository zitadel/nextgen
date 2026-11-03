import type { CreateFlow201StepGates } from "@zitadel/api/generated/model";

// Counter-zero fixture from the MIT protocol vectors. Never production puzzle
// material: keeping the mock cheap lets UI tests exercise the real Web Crypto path.
export function signupGate(sessionToken: string): CreateFlow201StepGates {
  return {
    signup_pow: {
      kind: "captcha",
      provider: "zitadel_pow",
      challenge: {
        protocol: "zitadel_pow_poc_v1",
        challenge_id: `ch_mock_${sessionToken}`,
        profile_id: "pbkdf2_sha256_5000_l1",
        salt: "101112131415161718191a1b1c1d1e1f",
        nonce: "a1a2a3a4a5a6a7a8a9aaabacadaeafb0",
        key_prefix: "d6b43ed560963f8eb291c574c7bc85c9",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      },
    },
  };
}
export function signupProof(sessionToken: string | undefined): string {
  if (!sessionToken) throw new Error("mock signup needs a session token");
  return JSON.stringify({
    protocol: "zitadel_pow_poc_v1",
    challenge_id: `ch_mock_${sessionToken}`,
    derived_key: "d6b43ed560963f8eb291c574c7bc85c9f8103b0489db4f1a4416d8d203b44d36",
  });
}
export function validSignupProof(proof: string | undefined, sessionToken: string): boolean {
  try {
    const got = JSON.parse(proof ?? "");
    const want = JSON.parse(signupProof(sessionToken));
    return (
      got.protocol === want.protocol &&
      got.challenge_id === want.challenge_id &&
      got.derived_key === want.derived_key
    );
  } catch {
    return false;
  }
}
