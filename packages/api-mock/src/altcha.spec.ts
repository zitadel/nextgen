import { describe, expect, it } from "vitest";

import { generateAltchaChallenge, verifyAltchaProof } from "./altcha.js";

/** Build the proof string the way `<zl-captcha>` does. */
function proofFor(challenge: { algorithm: string; challenge: string; salt: string }, number: number): string {
  return btoa(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number,
      salt: challenge.salt,
    }),
  );
}

describe("altcha challenge mint + verify", () => {
  it("accepts the proof for the minted solution", async () => {
    const challenge = await generateAltchaChallenge(42, 1000);
    expect(challenge.max_number).toBe(1000);
    await expect(verifyAltchaProof(challenge, proofFor(challenge, 42))).resolves.toBe(true);
  });

  it("rejects a proof with the wrong number", async () => {
    const challenge = await generateAltchaChallenge(42, 1000);
    await expect(verifyAltchaProof(challenge, proofFor(challenge, 41))).resolves.toBe(false);
  });

  it("rejects a proof whose salt does not match the issued challenge", async () => {
    const challenge = await generateAltchaChallenge(7, 1000);
    const foreign = { ...challenge, salt: "someone-elses-salt" };
    await expect(verifyAltchaProof(challenge, proofFor(foreign, 7))).resolves.toBe(false);
  });

  it("rejects malformed proof strings instead of throwing", async () => {
    const challenge = await generateAltchaChallenge();
    await expect(verifyAltchaProof(challenge, "not-base64-json")).resolves.toBe(false);
    await expect(verifyAltchaProof(challenge, btoa("[1,2,3]"))).resolves.toBe(false);
  });
});
