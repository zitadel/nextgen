import { format } from "node:util";

import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { _resetConfigForTesting } from "@zitadel/api/config";
import "@testing-library/jest-dom/vitest";

import { clearSessionCaches } from "./lib/session-cache";
import { _resetRuntimeForTesting } from "./runtime/runtime";
import { server } from "./test/msw";

// Console screens render after a router load, an API fetch and component
// effects, so `findBy*`/`waitFor` need more than RTL's 1s default to settle —
// but not much more once requests are mocked (the earlier flake was a screen
// that never finished because a request was unmocked, not a slow one). 5s is
// the give-up window; a real failure still reports in ~5s, not a minute.
configure({ asyncUtilTimeout: 5_000 });

// configureZitadel is write-once on globalThis so duplicate module copies
// share one slot. That slot also survives Vitest's per-file isolate, and
// this file's top-level body is not guaranteed to re-run for every spec in
// a worker. A file that bound the DEV `/api` default then leaked it into
// later files: CI fetched `http://localhost:3000/api` while MSW waited on
// `http://localhost/api`. Reset before and after each test so the next
// file's module init sees an empty slot even when setupFiles are cached.
_resetConfigForTesting();
beforeEach(_resetConfigForTesting);
afterEach(_resetConfigForTesting);

// Reads cached for the signed-in person (`GET /users/me/projects`) would
// otherwise carry one test's mocked answer into the next.
beforeEach(clearSessionCaches);

// Every spec answers requests from the one server (`src/test/msw.ts`), and a
// request no handler answers fails the test that made it rather than reaching
// the network. Registered before the console guard below, so its reset runs
// after the guard's cleanup: handlers still answer while the tree unmounts.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// A test that writes to console.error or console.warn fails. React reports a
// state update outside act(), a failed loader and a missing key there and then
// carries on, so the test passes and only CI's stderr shows it. A test that
// expects the output says so by mocking it:
// `vi.spyOn(console, "error").mockImplementation(() => undefined)`.
// Cleanup runs first so output from the unmount, or from an update that lands
// after the last assertion, counts against the test that caused it.
for (const method of ["error", "warn"] as const) {
  const original = console[method];
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    console[method] = (...args: unknown[]) => {
      calls.push(format(...args));
    };
  });
  afterEach(() => {
    cleanup();
    console[method] = original;
    if (calls.length > 0) {
      throw new Error(
        `Expected the test not to call console.${method}(), but it did ${calls.length} ` +
          `time(s). The first call:\n\n${calls[0]}`,
      );
    }
  });
}

// The app router preloads a link's route when it is hovered (`defaultPreload:
// "intent"`), so a hover followed by a click loads a screen twice whenever the
// two are far enough apart — which a busy machine makes them. Specs assert on
// what a screen asked for, not on when a hover happened, so every router a spec
// builds starts with preload off. Production keeps it.
//
// Every screen is a code-split chunk the router imports on its first visit.
// Left to the first render, that cold import runs inside the file's first
// `findBy*`, and on a busy CI runner it alone can outlast asyncUtilTimeout: the
// file's first test fails while the rest pass. So the mock imports every
// screen's chunk before it hands out the router; the route objects keep them
// loaded for every router the file builds.
vi.mock("./router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./router")>();
  const { createMemoryHistory } = await import("@tanstack/react-router");
  const preloadRouter = actual.createAppRouter({ history: createMemoryHistory() });
  await Promise.all(
    Object.values(preloadRouter.routesById).map((route) => preloadRouter.loadRouteChunk(route)),
  );
  return {
    ...actual,
    createAppRouter: (...args: Parameters<typeof actual.createAppRouter>) => {
      const router = actual.createAppRouter(...args);
      router.update({ ...router.options, defaultPreload: false });
      return router;
    },
  };
});

// jsdom has no matchMedia; the theme hook (src/theme.ts) reads it. Default to
// dark (no light-scheme match) and provide the add/removeEventListener surface.
if (typeof window !== "undefined" && !window.matchMedia) {
  const noop = (): undefined => undefined;
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom has no ResizeObserver; Radix popover/menu content measures with it
// (used by the sidebar user menu). A no-op stub is enough for jsdom specs.
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverStub {
    // The real constructor's signature, so `new ResizeObserver(callback)` in
    // the code under test matches it. Kept, though jsdom specs never call it.
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(): void {
      /* no-op: jsdom specs never lay out */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

// jsdom has no scrollTo; TanStack Router's scroll restoration calls it on
// navigation. A no-op keeps passing runs free of "Not implemented" stderr spam.
if (typeof window !== "undefined") {
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
}

// jsdom implements no Pointer Capture API and no scrollIntoView. Radix's
// popover/dropdown triggers call `hasPointerCapture` while deciding whether a
// pointerdown became a drag, and cmdk scrolls its active option into view — so
// without these a combobox never opens under test (the click is swallowed
// before Radix toggles state).
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

// Every spec starts with no runtime document, so no sign-in project. One that
// needs a project sets it with `_setRuntimeForTesting`, as the server would.
beforeEach(_resetRuntimeForTesting);
