import "@testing-library/jest-dom/vitest";

// @ts-expect-error Needed for tests
global.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no matchMedia; the theme hook (src/theme.ts) reads it. Default to
// dark (no light-scheme match) and provide the add/removeEventListener surface.
if (typeof window !== "undefined" && !window.matchMedia) {
  const noop = (): undefined => undefined;
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom has no ResizeObserver; Radix popover/menu content measures with it
// (used by the sidebar user menu). A no-op stub is enough for jsdom specs.
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe(): void {
      /* no-op: jsdom specs never lay out */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}
