import "@zitadel/components";

import "./styles.css";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("project_id") ?? params.get("project-id") ?? "demo";

const app = document.getElementById("app");
if (app) {
  const login = document.createElement("zitadel-login");
  login.setAttribute("purpose", "login");
  login.setAttribute("project-id", projectId);
  app.append(login);
}
