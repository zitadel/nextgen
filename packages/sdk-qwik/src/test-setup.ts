import { afterEach, vi } from "vitest";

// Clears the rendered DOM and restores stubbed globals after every spec. Qwik
// renders through `@builder.io/qwik` (not testing-library), so the DOM is reset
// by hand; this mirrors the per-framework test bootstrap the other SDKs
// register via `setupFiles`.
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
