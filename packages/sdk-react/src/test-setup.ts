import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmounts rendered components and clears the DOM after every spec
// (testing-library's recommended setup-file pattern), mirroring the
// per-framework test bootstrap the other SDKs register via `setupFiles`.
afterEach(() => {
  cleanup();
});
