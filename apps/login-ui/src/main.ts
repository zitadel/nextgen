import "@zitadel/components";

import "./styles.css";

const params = new URLSearchParams(window.location.search);
const projectId =
  params.get("project_id") ??
  params.get("project-id") ??
  import.meta.env.VITE_PROJECT_ID ??
  "demo";

const app = document.getElementById("app");
if (app) {
  const login = document.createElement("zitadel-login");
  login.setAttribute("purpose", "login");
  login.setAttribute("project-id", projectId);
  if (import.meta.env.VITE_PROXY_PATH) {
    login.setAttribute("proxy-path", import.meta.env.VITE_PROXY_PATH);
  }
  app.append(login);
}
