import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/app.tsx`: a minimal path-based router that renders the
 * `@zitadel/sdk-qwik` widgets — login at `/login` (and `/`), register at
 * `/register`, and the logout widget at `/profile`. Exports a named `App`
 * (`component$`) to match the create-vite Qwik entry (`main.tsx` imports
 * `{ App }`). The project id comes from `VITE_ZITADEL_PROJECT_ID`. No secret
 * reaches the browser: the dev proxy in `vite.config.*` attaches the
 * `sk_<project_id>` bearer (derived from the public project id) server-side.
 */
export function appTemplate(): string {
  return `${MANAGED_MARKER}
import { component$ } from "@builder.io/qwik";
import { ZitadelLogin, ZitadelLogout, configureZitadel } from "@zitadel/sdk-qwik";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

export const App = component$(() => {
  const path = window.location.pathname;

  if (path.startsWith("/profile")) {
    return <ZitadelLogout project={project} postSignOutUrl="/login" />;
  }
  if (path.startsWith("/register")) {
    return <ZitadelLogin project={project} purpose="register" postSignInUrl="/profile" />;
  }
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/profile" />;
});
`;
}
