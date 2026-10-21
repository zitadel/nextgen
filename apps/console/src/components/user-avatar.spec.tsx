import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserAvatar, avatarVars } from "./user-avatar";

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

describe("UserAvatar", () => {
  it("speeds its light up from where it is, without restarting it", () => {
    // jsdom runs no CSS animations, so stand in for the two the light runs.
    const updatePlaybackRate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: () => [{ updatePlaybackRate }, { updatePlaybackRate }],
    });
    try {
      const { rerender } = render(<UserAvatar seed="user_1" />);
      rerender(<UserAvatar seed="user_1" fast />);
      expect(updatePlaybackRate).toHaveBeenLastCalledWith(4);
      rerender(<UserAvatar seed="user_1" />);
      expect(updatePlaybackRate).toHaveBeenLastCalledWith(1);
    } finally {
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });
});
