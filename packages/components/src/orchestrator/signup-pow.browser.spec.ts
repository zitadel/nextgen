import { describe, expect, it } from "vitest";
import vectors from "../../../../docs/design/flowengine/testdata/pow-v1-vectors.json";
import { solveSignupPow } from "./signup-pow.js";

const vector = vectors.vectors[0]!;
const challenge = () => ({
  ...vector.public,
  expires_at: new Date(Date.now() + 300_000).toISOString(),
});

describe("native browser signup solver", () => {
  it("produces the exact full proof accepted by the Go verifier", async () => {
    expect(await solveSignupPow(challenge(), new AbortController().signal)).toBe(vector.proof);
  });
  it("refuses unknown costs before doing work", async () => {
    await expect(
      solveSignupPow(
        { ...challenge(), profile_id: "pbkdf2_sha256_999999999_l1" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Unsupported");
  });
  it("refuses expired challenges and respects cancellation", async () => {
    await expect(
      solveSignupPow(
        { ...challenge(), expires_at: new Date(0).toISOString() },
        new AbortController().signal,
      ),
    ).rejects.toThrow("expired");
    const abort = new AbortController();
    abort.abort();
    await expect(solveSignupPow(challenge(), abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
