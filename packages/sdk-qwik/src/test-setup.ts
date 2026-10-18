import { serveMockFlowApi } from "@zitadel/api-mock/vitest-browser";
import { afterEach, vi } from "vitest";

// Serves the mock Flow API (`@zitadel/api-mock`) to every spec, so a mounted
// widget talks to the same handlers the components suite and Storybook use
// instead of a network that is not there.
serveMockFlowApi();

// Clears the rendered DOM and restores stubbed globals after every spec. The
// suite runs in a real browser (one shared page), and Qwik renders through
// `@qwik.dev/core` (not testing-library), so the DOM is reset by hand; this
// mirrors the per-framework test bootstrap the other SDKs register via
// `setupFiles`. It also drops the `window.__unsetProp` hook the unset-prop
// harness installs, so a poll in one case never picks up the previous case's
// callback.
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { __unsetProp?: unknown }).__unsetProp;
  document.body.innerHTML = "";
});
