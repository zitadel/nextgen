// Base design-system tokens. Standalone atoms outside `<zitadel-login>`
// resolve `var(--zl-*)` against the host page; loading the CSS here puts
// `--zl-*` on `:root` so the atoms-only page paints correctly. Inside the
// orchestrator, `applyBaseTokens` adopts the same layer into the shadow
// root, so the `<zitadel-login>` route doesn't depend on this import.
import "@zitadel/design-tokens/css/tokens.css";

import "../src/index.js";
import { configureZitadel } from "@zitadel/api/config";
import { applyBranding, setupMock } from "@zitadel/api-mock";
import { setupWorker } from "msw/browser";

import { brandingPresets } from "./branding-presets.js";
import { renderAtomPlayground } from "./pages/atoms.js";
import { renderLoginPage } from "./pages/login.js";

type Route = "atoms" | "login";

function getRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("route");
  return value === "login" ? "login" : "atoms";
}

function highlightNav(route: Route): void {
  document.querySelectorAll<HTMLAnchorElement>("nav a[data-route]").forEach((link) => {
    if (link.dataset.route === route) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function mountRoute(): void {
  const route = getRoute();
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = "";
  highlightNav(route);
  if (route === "login") {
    renderLoginPage(app);
  } else {
    renderAtomPlayground(app);
  }
}

async function bootstrap(): Promise<void> {
  // Point the orval client at any same-origin host so the MSW worker has
  // an absolute URL to intercept. The host doesn't have to resolve — the
  // generated handlers match against `*/flow*` regardless.
  configureZitadel({
    proxyPath: window.location.origin,
    projectId: "dev",
  });

  const worker = setupWorker();
  setupMock(worker);
  applyBranding(brandingPresets.centered);

  // Vite serves dev/ at /, so MSW finds dev/mockServiceWorker.js at the
  // default URL (/mockServiceWorker.js) without an explicit override.
  await worker.start({ onUnhandledRequest: "bypass" });

  window.addEventListener("popstate", mountRoute);
  mountRoute();
}

if (import.meta.hot) {
  import.meta.hot.accept(["./pages/atoms.js", "./pages/login.js"], () => {
    mountRoute();
  });
}

void bootstrap();
