import { RouterProvider, createRouter } from "@tanstack/react-router";
import { setupMock } from "@zitadel-nextgen/api-mock";
import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";
import { setupWorker } from "msw/browser";
import ReactDOM from "react-dom/client";

import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/**
 * Pre-release: the console is a components preview, not a real app yet.
 * Until the real Flow API backend is wired in, MSW intercepts the flow
 * routes with the `@zitadel-nextgen/api-mock` xstate handlers so the
 * `<zitadel-login>` orchestrator runs end-to-end. Gated on
 * `import.meta.env.DEV` so production builds never load the worker shim.
 *
 * On the very first registration, the service worker activates but the
 * page that registered it is not yet under its control — fetches bypass
 * MSW until the next navigation. The one-shot reload below is the
 * standard MSW workaround; the sessionStorage marker keeps it from
 * looping.
 */
const RELOAD_MARKER = "msw:reloaded";

async function bootstrapMockApi(): Promise<void> {
  if (!import.meta.env.DEV) return;
  setApiBaseUrl(window.location.origin);
  const worker = setupWorker();
  setupMock(worker);
  await worker.start({ onUnhandledRequest: "bypass" });

  if (!navigator.serviceWorker.controller && !sessionStorage.getItem(RELOAD_MARKER)) {
    sessionStorage.setItem(RELOAD_MARKER, "1");
    window.location.reload();
    await new Promise<never>((_resolve) => undefined);
  }
  sessionStorage.removeItem(RELOAD_MARKER);
}

async function main(): Promise<void> {
  await bootstrapMockApi();

  const rootElement = document.getElementById("app");
  if (rootElement && !rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(<RouterProvider router={router} />);
  }
}

void main();
