import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  basepath: import.meta.env.PROD ? "/ui/console" : undefined,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/** Drop stale MSW service workers from when the console embedded the orchestrator. */
async function clearStaleServiceWorkers(): Promise<void> {
  if (!import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

async function main(): Promise<void> {
  await clearStaleServiceWorkers();

  const rootElement = document.getElementById("app");
  if (rootElement && !rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(<RouterProvider router={router} />);
  }
}

void main();
