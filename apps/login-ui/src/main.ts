import "@zitadel/components";

import "./styles.css";

const params = new URLSearchParams(window.location.search);
const devProjectId = import.meta.env.DEV ? import.meta.env.VITE_PROJECT_ID : undefined;
const devProxyPath = import.meta.env.DEV ? import.meta.env.VITE_PROXY_PATH : undefined;
const projectId =
  params.get("project_id") ??
  params.get("project-id") ??
  devProjectId ??
  "demo";

const app = document.getElementById("app");
if (app) {
  const login = document.createElement("zitadel-login");
  login.setAttribute("purpose", "login");
  login.setAttribute("project-id", projectId);
  if (devProxyPath) {
    login.setAttribute("proxy-path", devProxyPath);
  }
  app.append(login);
}
