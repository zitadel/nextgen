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

// jsdom has no scrollTo; TanStack Router's scroll restoration calls it on
// navigation. A no-op keeps passing runs free of "Not implemented" stderr spam.
if (typeof window !== "undefined") {
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
}

// jsdom implements no Pointer Capture API and no scrollIntoView. Radix's
// popover/dropdown triggers call `hasPointerCapture` while deciding whether a
// pointerdown became a drag, and cmdk scrolls its active option into view — so
// without these a combobox never opens under test (the click is swallowed
// before Radix toggles state).
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

// Hermetic env: Vitest (via Vite) loads `.env.local`, so without this stub a
// developer's local VITE_CONSOLE_PROJECT_ID would leak into test requests and
// make outcomes depend on gitignored local files. Specs that need a value
// stub their own (vi.stubEnv wins over this default).
vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
