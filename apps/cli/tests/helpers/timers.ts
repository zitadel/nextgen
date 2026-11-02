import { vi } from "vitest";

/**
 * `vi.useFakeTimers()` fakes the global `setTimeout`, not the one exported by
 * `node:timers/promises`, so code that waits with the latter would sit out the
 * real delay under fake timers. This routes that module through the global
 * `setTimeout`, which is the real one until a test fakes it and the fake one
 * after, so a test advances every wait the same way.
 */
vi.mock("node:timers/promises", () => ({
  setTimeout: <T = void>(ms: number, value?: T) =>
    new Promise<T>((resolve) => globalThis.setTimeout(() => resolve(value as T), ms)),
}));
