import { format } from "node:util";

import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, type MockInstance, vi } from "vitest";
import { _resetConfigForTesting } from "@zitadel/api/config";
import "@testing-library/jest-dom/vitest";

import { clearSessionCaches } from "./lib/session-cache";
import { _resetRuntimeForTesting } from "./runtime/runtime";

// Console screens render after a router load, an API fetch and component
// effects. On a cold or loaded CI runner that first render can exceed RTL's
// default 1s findBy/waitFor window, which flaked the suite. Give the async
// queries more headroom for every console spec.
configure({ asyncUtilTimeout: 5000 });

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

// React reports a state update outside `act(...)` on console.error and carries
// on, so a test that ends while the router is still transitioning used to pass
// and only flood stderr. Fail it instead. Testing Library's async utilities
// (findBy*, waitFor, userEvent) already wrap their work in act; a warning means
// the test stopped waiting too early or drove the page from outside them.
// Cleanup runs first so an update that lands between the last assertion and
// the unmount is counted against this test, not the next one.
let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  cleanup();
  const actWarnings = consoleError.mock.calls
    .map((args) => format(...args))
    .filter((message) => message.includes("not wrapped in act("));
  consoleError.mockRestore();
  if (actWarnings.length > 0) {
    throw new Error(
      `${actWarnings.length} React state update(s) ran outside act(); the first was: ` +
        `${actWarnings[0]?.split("\n")[0]} Wait for the screen to settle with findBy* or ` +
        "waitFor before the test ends.",
    );
  }
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

// Hermetic env: Vitest (via Vite) loads `.env.local`, so without this stub a
// local VITE_CONSOLE_RUNTIME_FALLBACK would turn runtime-discovery failures
// back into the standalone fallback (Console ADR 0004 §3), making outcomes
// depend on a gitignored local file. Specs that need a value stub their own
// (vi.stubEnv wins over this default).
vi.stubEnv("VITE_CONSOLE_RUNTIME_FALLBACK", "");

// Every spec starts with no runtime document, so no sign-in project. One that
// needs a project sets it with `_setRuntimeForTesting`, as the server would.
beforeEach(_resetRuntimeForTesting);
