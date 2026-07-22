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
