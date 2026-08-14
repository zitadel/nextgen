import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { createAppRouter } from "./router";
import { initRuntime } from "./runtime/runtime";

const router = createAppRouter();

/** Drop stale MSW service workers from when the console embedded the orchestrator. */
async function clearStaleServiceWorkers(): Promise<void> {
  if (!import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

async function main(): Promise<void> {
  await clearStaleServiceWorkers();
  // Discover deployment runtime metadata (mode + project ids) before any
  // route guard or loader runs (Console ADR 0004 §3). Today an unreachable
  // endpoint resolves to the standalone fallback so rendering never blocks on
  // a broken backend; §3 supersedes that with an explicit error state, which
  // is a pending change tracked in that ADR's Consequences.
  await initRuntime();

  const rootElement = document.getElementById("app");
  if (rootElement && !rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(<RouterProvider router={router} />);
  }
}

void main();
