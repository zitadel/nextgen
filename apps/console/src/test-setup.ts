import { configure } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { _resetConfigForTesting } from "@zitadel/api/config";
import "@testing-library/jest-dom/vitest";

import { clearSessionCaches } from "./lib/session-cache";

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

// @ts-expect-error Needed for tests
global.IS_REACT_ACT_ENVIRONMENT = true;

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

// Hermetic env: Vitest (via Vite) loads `.env.local`, so without these stubs a
// developer's local VITE_CONSOLE_PROJECT_ID would leak into test requests, and
// a local VITE_CONSOLE_RUNTIME_FALLBACK would turn runtime-discovery failures
// back into the standalone fallback (Console ADR 0004 §3) — both make outcomes
// depend on gitignored local files. Specs that need a value stub their own
// (vi.stubEnv wins over these defaults).
vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
vi.stubEnv("VITE_CONSOLE_RUNTIME_FALLBACK", "");
