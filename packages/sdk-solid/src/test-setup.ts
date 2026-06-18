import { cleanup } from "@solidjs/testing-library";
import { afterEach, vi } from "vitest";

// Unmounts rendered components and restores stubbed globals after every spec
// (testing-library's recommended setup-file pattern), mirroring the
// per-framework test bootstrap the other SDKs register via `setupFiles`.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
