import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.tsx`: a minimal path-based router that renders the
 * `@zitadel/sdk-react` widgets — login at `/login` (and `/`), register at
 * `/register`, and the logout widget at `/profile`. The project id comes from
 * `VITE_ZITADEL_PROJECT_ID` (Vite only exposes `VITE_`-prefixed env to the
 * client). No secret reaches the browser: the dev proxy in `vite.config.*`
 * attaches the `sk_<project_id>` bearer (derived from the public project id)
 * server-side.
 */
export function appTemplate(): string {
  return `${MANAGED_MARKER}
import { ZitadelLogin, ZitadelLogout, configureZitadel } from "@zitadel/sdk-react";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

export default function App() {
  const path = window.location.pathname;

  const content = path.startsWith("/profile") ? (
    <ZitadelLogout project={project} postSignOutUrl="/login" />
  ) : path.startsWith("/register") ? (
    <ZitadelLogin project={project} purpose="register" postSignInUrl="/profile" />
  ) : (
    <ZitadelLogin project={project} purpose="login" postSignInUrl="/profile" />
  );

  // Enforce the dark surface the Zitadel widgets are designed for, so the page
  // never follows the OS light/dark setting.
  return (
    <main style={{ minHeight: "100vh", colorScheme: "dark", background: "#0f0f11", color: "#f4f4f6" }}>
      {content}
    </main>
  );
}
`;
}
