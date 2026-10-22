import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserAvatar } from "./user-avatar";

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
