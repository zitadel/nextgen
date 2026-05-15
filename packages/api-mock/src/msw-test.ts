/**
 * Vitest fixture that boots a fresh `msw/browser` worker per test and
 * tears it down afterwards. Consumed by `*.browser.spec.ts` files that
 * exercise the `setupMock(worker)` browser entry point.
 *
 * The node-mode contract suite (`index.spec.ts`) uses `msw/node`
 * directly and does not need this fixture.
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
