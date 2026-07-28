/**
 * `@zitadel/api-mock` — shared mock for the typed
 * `@zitadel/api` Flow API.
 *
 * Three entry points:
 *
 * - `setupMockHandlers()` returns `{ handlers, reset, getCaptured }`. Plug
 *   `handlers` into `setupServer(...)` for node tests or pass to a worker
 *   for the browser. Callers should hold onto `reset` and `getCaptured` and
 *   call them directly — this avoids any shared module-level state.
 * - `setupMock(worker)` is a convenience for the browser path that pipes the
 *   same handlers into `worker.use(...)`. The module-level `resetFlow()` and
 *   `getCapturedRequests()` delegate to the most recently created handle from
 *   `setupMock`, which is safe when only one mock is active at a time.
 * - `startMockServer(port)` (from `./server.js`) — Express + MSW middleware
 *   for `apps/demo-next` and `apps/demo-nuxt`. Applies `defaultDevBranding`
 *   (Arimo `font_url`) on boot; see `default-dev-branding.ts`.
 *
 * Helpers:
 *
 * - `applyBranding(branding)` injects a tenant branding overlay merged into
 *   every response. Pass `null` (or call `clearBranding()`) to remove it.
 */
import type { SetupWorker } from "msw/browser";

import { applyBranding, clearBranding } from "./branding.js";
import { setupMockHandlers, type CapturedRequest, type MockHandle } from "./handlers.js";

/** Tracks the most recent handle from setupMock() for browser-path delegation. */
let _browserHandle: MockHandle | null = null;

export function setupMock(worker: SetupWorker): SetupWorker {
  const mock = setupMockHandlers();
  _browserHandle = mock;
  worker.use(...mock.handlers);
  return worker;
}

/**
 * Reset the actor for the most recently created browser mock.
 * For node tests, prefer calling `mock.reset()` on the object returned by
 * `setupMockHandlers()` directly.
 */
export function resetFlow(): void {
  _browserHandle?.reset();
}

/**
 * Return captured requests for the most recently created browser mock.
 * For node tests, prefer calling `mock.getCaptured()` on the object returned
 * by `setupMockHandlers()` directly.
 */
export function getCapturedRequests(): readonly CapturedRequest[] {
  return _browserHandle?.getCaptured() ?? [];
}

export { applyBranding, clearBranding, setupMockHandlers };

/**
 * The password step's field name — the schema pointer the real server emits.
 * Exported so consumers submit the same key the backend accepts instead of
 * hard-coding a short `password` the server would reject.
 */
export { PASSWORD_FIELD } from "./fixtures/login.js";

export type { CapturedRequest, MockHandle };
export type { MockBranding } from "./branding.js";
export type { FlowStepName } from "./flow-machine.js";
