import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { createAppRouter } from "./router";

const router = createAppRouter();

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
