/**
 * Vitest fixture that boots a fresh `msw/browser` worker per test and
 * tears it down afterwards. Consumed by `index.spec.ts` and any future
 * spec that wants to drive the orval client against the api-mock
 * handlers under chromium.
 *
 * Tests written against this fixture look like:
 *
 * ```ts
 * import { test } from "./msw-test";
 *
 * test("walks the flow", async ({ worker }) => {
 *   setupMock(worker);
 *   // ... call createFlow / submitFlowStep ...
 * });
 * ```
 */
import { setupWorker, type SetupWorker } from "msw/browser";
import { test as testBase } from "vitest";

export const worker: SetupWorker = setupWorker();

export const test = testBase.extend<{ worker: SetupWorker }>({
  worker: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await worker.start({ onUnhandledRequest: "error" });
      await use(worker);
      worker.resetHandlers();
    },
    { auto: true },
  ],
});
