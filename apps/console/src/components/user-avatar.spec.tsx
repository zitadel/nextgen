import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserAvatar, avatarSeed, avatarVars } from "./user-avatar";

const avatarGradient = (seed: string) => JSON.stringify(avatarVars(seed));

describe("avatarVars", () => {
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

describe("avatarSeed", () => {
  it("seeds from the identifier as typed at sign-in, whatever its case or spacing", () => {
    expect(avatarSeed({ identifier: "  Maya@Example.com ", userId: "user_1" })).toBe(
      "maya@example.com",
    );
  });

  it("falls back to the user id only when there is no identifier", () => {
    expect(avatarSeed({ userId: "user_1" })).toBe("user_1");
    expect(avatarSeed({ identifier: "  ", userId: "user_1" })).toBe("user_1");
    expect(avatarSeed(undefined)).toBe("");
  });
});

describe("UserAvatar", () => {
  it("eases up to speed on hover, and coasts back to rest", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    // jsdom runs no CSS animations, so stand in for the gradient's.
    const updatePlaybackRate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: () => [{ updatePlaybackRate }],
    });
    try {
      const { rerender } = render(<UserAvatar seed="user_1" />);
      rerender(<UserAvatar seed="user_1" fast />);
      vi.advanceTimersByTime(1500);
      // It picks up speed rather than jumping to it.
      const rising = updatePlaybackRate.mock.lastCall?.[0] as number;
      expect(rising).toBeGreaterThan(1);
      expect(rising).toBeLessThan(4);
      vi.advanceTimersByTime(2000);
      expect(updatePlaybackRate).toHaveBeenLastCalledWith(4);

      rerender(<UserAvatar seed="user_1" />);
      vi.advanceTimersByTime(1500);
      // Halfway through the slow-down it is still faster than at rest.
      const midway = updatePlaybackRate.mock.lastCall?.[0] as number;
      expect(midway).toBeGreaterThan(1);
      expect(midway).toBeLessThan(4);

      vi.advanceTimersByTime(2000);
      expect(updatePlaybackRate).toHaveBeenLastCalledWith(1);
    } finally {
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
      vi.useRealTimers();
    }
  });
});
