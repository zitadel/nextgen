import { vi } from "vitest";

/**
 * `vi.useFakeTimers()` fakes the global `setTimeout`, not the one exported by
 * `node:timers/promises`, so code that waits with the latter would sit out the
 * real delay under fake timers. This routes that module through the global
 * `setTimeout`, which is the real one until a test fakes it and the fake one
 * after, so a test advances every wait the same way. It honours the `signal`
 * and `ref` options the real one takes, which the code under test relies on, and
 * leaves every other export of the module as it is.
 */
vi.mock("node:timers/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:timers/promises")>()),
  setTimeout: <T = void>(
    ms: number,
    value?: T,
    options: { signal?: AbortSignal; ref?: boolean } = {},
  ) =>
    new Promise<T>((resolve, reject) => {
      const { signal, ref } = options;
      const aborted = () =>
        Object.assign(new Error("The operation was aborted"), {
          name: "AbortError",
          code: "ABORT_ERR",
          cause: signal?.reason,
        });
      if (signal?.aborted) {
        reject(aborted());
        return;
      }
      const onAbort = () => {
        globalThis.clearTimeout(timer);
        reject(aborted());
      };
      const timer = globalThis.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve(value as T);
      }, ms);
      if (ref === false) {
        timer.unref();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
}));
