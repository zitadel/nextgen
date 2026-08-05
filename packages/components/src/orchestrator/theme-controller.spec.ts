import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeController } from "./theme-controller.js";
import type { Branding } from "./branding.js";

type FakeMql = MediaQueryList & {
  __triggerChange: (matches: boolean) => void;
};

function fakeMatchMedia(initial: boolean): { mql: FakeMql; matchMedia: typeof matchMedia } {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches: initial,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    __triggerChange: (matches: boolean) => {
      (mql as { matches: boolean }).matches = matches;
      const event = { matches } as MediaQueryListEvent;
      for (const listener of [...listeners]) listener(event);
    },
  } as unknown as FakeMql;
  return { mql, matchMedia: ((_query: string) => mql) as typeof matchMedia };
}

class FakeHost {
  controllers: ThemeController[] = [];
  updateCount = 0;

  addController(controller: ThemeController): void {
    this.controllers.push(controller);
  }

  removeController(): void {
    /* no-op */
  }

  requestUpdate(): void {
    this.updateCount += 1;
  }

  updateComplete = Promise.resolve(true);
}

const originalMatchMedia = globalThis.matchMedia;

describe("ThemeController", () => {
  let host: FakeHost;

  beforeEach(() => {
    host = new FakeHost();
  });

  afterEach(() => {
    if (originalMatchMedia) {
      globalThis.matchMedia = originalMatchMedia;
    } else {
      // @ts-expect-error environment without matchMedia
      delete globalThis.matchMedia;
    }
    vi.restoreAllMocks();
  });

  it("defaults to dark when no branding is set", () => {
    const controller = new ThemeController(host);
    controller.hostConnected();
    expect(controller.theme).toBe("dark");
  });

  it("respects an explicit light mode opt-in", () => {
    const controller = new ThemeController(host);
    controller.setBranding({ theme: { mode: "light" } } as Branding);
    expect(controller.theme).toBe("light");
  });

  it("subscribes to prefers-color-scheme when mode is auto", () => {
    const { mql, matchMedia } = fakeMatchMedia(true);
    globalThis.matchMedia = matchMedia;
    const controller = new ThemeController(host);
    controller.setBranding({ theme: { mode: "auto" } } as Branding);
    expect(controller.theme).toBe("dark");
    mql.__triggerChange(false);
    expect(controller.theme).toBe("light");
    expect(host.updateCount).toBeGreaterThanOrEqual(1);
  });

  it("detaches the media listener when switching back to a fixed mode", () => {
    const { mql, matchMedia } = fakeMatchMedia(false);
    globalThis.matchMedia = matchMedia;
    const removeSpy = vi.spyOn(mql, "removeEventListener");
    const controller = new ThemeController(host);
    controller.setBranding({ theme: { mode: "auto" } } as Branding);
    controller.setBranding({ theme: { mode: "light" } } as Branding);
    expect(controller.theme).toBe("light");
    expect(removeSpy).toHaveBeenCalled();
  });

  it("releases the listener on host disconnect", () => {
    const { mql, matchMedia } = fakeMatchMedia(true);
    globalThis.matchMedia = matchMedia;
    const removeSpy = vi.spyOn(mql, "removeEventListener");
    const controller = new ThemeController(host);
    controller.setBranding({ theme: { mode: "auto" } } as Branding);
    controller.hostDisconnected();
    expect(removeSpy).toHaveBeenCalled();
  });

  describe("mode precedence: element > branding > fallback", () => {
    it("uses the fallback when neither element nor branding states a mode", () => {
      const { matchMedia } = fakeMatchMedia(false);
      globalThis.matchMedia = matchMedia;
      const controller = new ThemeController(host);
      // A widget defers to the visitor's preference…
      controller.setModePreference(undefined, "auto");
      expect(controller.theme).toBe("light");
      // …a page owns its surface.
      controller.setModePreference(undefined, "dark");
      expect(controller.theme).toBe("dark");
    });

    it("lets branding override the fallback", () => {
      const controller = new ThemeController(host);
      controller.setModePreference(undefined, "dark");
      controller.setBranding({ theme: { mode: "light" } } as Branding);
      expect(controller.theme).toBe("light");
    });

    it("lets the element's explicit mode beat branding", () => {
      // The embedding page knows its own surface better than stored
      // tenant branding does.
      const controller = new ThemeController(host);
      controller.setBranding({ theme: { mode: "dark" } } as Branding);
      controller.setModePreference("light", "auto");
      expect(controller.theme).toBe("light");
    });

    it("an explicit auto still follows prefers-color-scheme", () => {
      const { mql, matchMedia } = fakeMatchMedia(true);
      globalThis.matchMedia = matchMedia;
      const controller = new ThemeController(host);
      controller.setBranding({ theme: { mode: "light" } } as Branding);
      controller.setModePreference("auto", "dark");
      expect(controller.theme).toBe("dark");
      mql.__triggerChange(false);
      expect(controller.theme).toBe("light");
    });

    it("keeps dark when auto cannot read a preference", () => {
      // @ts-expect-error environment without matchMedia
      delete globalThis.matchMedia;
      const controller = new ThemeController(host);
      controller.setModePreference(undefined, "auto");
      expect(controller.theme).toBe("dark");
    });
  });
});
