import { RouterProvider } from "@tanstack/react-router";
import ReactDOM, { type Root } from "react-dom/client";

import { RuntimeUnavailable } from "./components/runtime-unavailable";
import { createAppRouter } from "./router";
import { type ConsoleRuntimeResult, initRuntime, retryRuntime } from "./runtime/runtime";

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
  if (!rootElement || rootElement.innerHTML) return;
  const root = ReactDOM.createRoot(rootElement);

  // Discover deployment runtime metadata (mode + project ids) before any
  // route guard or loader runs (Console ADR 0004 §3). An unreachable or
  // erroring endpoint is an error, not a mode: it renders the retryable
  // connectivity screen instead of the app — rendering, never blocking, so a
  // broken backend still produces a page an operator can act on.
  render(root, await initRuntime());
}

function render(root: Root, result: ConsoleRuntimeResult): void {
  if (result.ok) {
    root.render(<RouterProvider router={router} />);
    return;
  }

  root.render(
    <RuntimeUnavailable
      failure={result.failure}
      onRetry={async () => {
        render(root, await retryRuntime());
      }}
    />,
  );
}

void main();
