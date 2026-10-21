import { describe, expect, it } from "vitest";

import { avatarGradient } from "./user-avatar";

describe("avatarGradient", () => {
  it("gives a seed the same gradient every time", () => {
    expect(avatarGradient("user_1")).toBe(avatarGradient("user_1"));
  });

  it("draws two different design-system starts", () => {
    for (const seed of ["user_1", "user_2", "a", "", "01JZXYZ"]) {
      const starts = avatarGradient(seed).match(/--zl-gradient-[a-z]+-start/g);
      expect(starts).toHaveLength(2);
      expect(starts?.[0]).not.toBe(starts?.[1]);
    }
  });

  it("tells people apart", () => {
    const gradients = new Set(
      Array.from({ length: 50 }, (_, index) => avatarGradient(`user_${index}`)),
    );
    expect(gradients.size).toBeGreaterThan(45);
  });
});
