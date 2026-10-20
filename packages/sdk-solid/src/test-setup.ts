import { cleanup } from "@solidjs/testing-library";
import { serveMockFlowApi } from "@zitadel/api-mock/vitest";
import { afterEach, vi } from "vitest";

// Serves the mock Flow API (`@zitadel/api-mock`) to every spec, so a mounted
// widget talks to the same handlers the components suite and Storybook use
// instead of a network that is not there.
serveMockFlowApi();

// Unmounts rendered components and restores stubbed globals after every spec
// (testing-library's recommended setup-file pattern), mirroring the
// per-framework test bootstrap the other SDKs register via `setupFiles`.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
