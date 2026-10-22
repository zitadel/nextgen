import { describe, expect, it } from "vitest";

import { avatarSeed, avatarVars } from "./avatar.js";

const gradient = (seed: string) => JSON.stringify(avatarVars(seed));

describe("avatarVars", () => {
  it("gives a seed the same gradient every time", () => {
    expect(gradient("maya@example.com")).toBe(gradient("maya@example.com"));
  });

  it("paints an identifier the same whatever its case or spacing", () => {
    expect(gradient("  Maya@Example.com ")).toBe(gradient("maya@example.com"));
  });

  it("keeps a seed's colours, so the login and the console agree across releases", () => {
    expect(avatarVars("maya@example.com")).toEqual({
      "--avatar-from": "var(--zl-gradient-red-start)",
      "--avatar-to": "var(--zl-gradient-purple-start)",
      "--avatar-base": "324deg",
      "--avatar-phase": "-712s",
    });
  });

  it("draws two different design-system starts", () => {
    for (const seed of ["user_1", "user_2", "a", "", "01JZXYZ"]) {
      const starts = gradient(seed).match(/--zl-gradient-[a-z]+-start/g);
      expect(starts).toHaveLength(2);
      expect(starts?.[0]).not.toBe(starts?.[1]);
    }
  });

  it("tells people apart", () => {
    const gradients = new Set(Array.from({ length: 50 }, (_, index) => gradient(`user_${index}`)));
    expect(gradients.size).toBeGreaterThan(45);
  });
});

describe("avatarSeed", () => {
  it("seeds from the identifier, never the user id beside it", () => {
    expect(avatarSeed({ identifier: "maya@example.com", userId: "user_1" })).toBe(
      "maya@example.com",
    );
  });

  it("falls back to the user id only when there is no identifier", () => {
    expect(avatarSeed({ userId: "user_1" })).toBe("user_1");
    expect(avatarSeed({ identifier: "  ", userId: "user_1" })).toBe("user_1");
    expect(avatarSeed(undefined)).toBe("");
  });
});
