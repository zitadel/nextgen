/**
 * `@zitadel-nextgen/api-mock` — shared mock for the typed
 * `@zitadel-nextgen/api` Flow API.
 *
 * Two entry points:
 *
 * - `setupMockHandlers()` returns an array of MSW `RequestHandler`s. Plug
 *   into `setupServer(...)` for node tests or pass to a worker for the
 *   browser. Calling it resets the underlying xstate actor so each test /
 *   playground session starts at the identifier step.
 * - `setupMock(worker)` is a tiny convenience for the browser path that
 *   pipes the same handlers into `worker.use(...)`.
 *
 * Helpers:
 *
 * - `applyBranding(branding)` injects a tenant branding overlay merged into
 *   every response. Pass `null` (or call `clearBranding()`) to remove it.
 * - `getCapturedRequests()` exposes captured request bodies for assertions.
 * - `resetFlow()` rewinds the actor without rebuilding handlers — handy for
 *   tests that share a `setupServer` across cases.
 */
import type { SetupWorker } from "msw/browser";

import { applyBranding, clearBranding } from "./branding.js";
import {
  getCapturedRequests,
  resetFlow,
  setupMockHandlers,
  type CapturedRequest,
} from "./handlers.js";

export function setupMock(worker: SetupWorker): SetupWorker {
  worker.use(...setupMockHandlers());
  return worker;
}

export {
  applyBranding,
  clearBranding,
  getCapturedRequests,
  resetFlow,
  setupMockHandlers,
};

export type { CapturedRequest };
export type { MockBranding } from "./branding.js";
export type { FlowStepName } from "./flow-machine.js";
