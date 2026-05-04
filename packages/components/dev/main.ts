import "../src/index.js";
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

window.addEventListener("popstate", mountRoute);
mountRoute();
