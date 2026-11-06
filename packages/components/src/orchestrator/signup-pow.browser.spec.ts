import { describe, expect, it, vi } from "vitest";
import vector from "./__fixtures__/signup-pow-vector.json";
import { solveSignupPow } from "./signup-pow.js";

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
  it("does not trust the device clock for server expiry", async () => {
    const c = challenge();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_000);
    try {
      expect(await solveSignupPow(c, new AbortController().signal)).toBe(vector.proof);
    } finally {
      clock.mockRestore();
    }
  });
  it("respects cancellation", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(solveSignupPow(challenge(), abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
