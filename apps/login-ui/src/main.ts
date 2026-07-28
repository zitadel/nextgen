import "@zitadel/components";

import "./styles.css";

const params = new URLSearchParams(window.location.search);
const devProjectId = import.meta.env.DEV ? import.meta.env.VITE_PROJECT_ID : undefined;
const devProxyPath = import.meta.env.DEV ? import.meta.env.VITE_PROXY_PATH : undefined;
const proxyPath = import.meta.env.DEV ? devProxyPath : "/";
const projectId =
  params.get("project_id") ??
  params.get("project-id") ??
  devProjectId ??
  "demo";

const app = document.getElementById("app");
if (app) {
  const login = document.createElement("zitadel-login");
  // The hosted shell IS the page — opt into the full-page chrome the
  // widget-first default no longer paints on its own.
  login.setAttribute("variant", "page");
  login.setAttribute("purpose", "login");
  login.setAttribute("project-id", projectId);
  if (proxyPath) {
    login.setAttribute("proxy-path", proxyPath);
  }
  app.append(login);
}
