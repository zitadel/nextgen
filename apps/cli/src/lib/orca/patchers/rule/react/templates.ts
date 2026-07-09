import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.tsx`: a minimal path-based router that renders the
 * `@zitadel/sdk-react` widgets — login at `/login`, register at `/register`, and
 * the signed-in session card at `/profile`. The root path redirects to `/login`.
 * The project id comes from `VITE_ZITADEL_PROJECT_ID` (Vite only exposes
 * `VITE_`-prefixed env to the client). No secret reaches the browser: the dev
 * proxy in `vite.config.*` attaches the project service-key secret (from
 * `ZITADEL_PROJECT_SECRET`) server-side.
 */
export function appTemplate(): string {
  return `${MANAGED_MARKER}
import { useEffect } from "react";
import { ZitadelLogin, ZitadelSession, configureZitadel } from "@zitadel/sdk-react";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

export default function App() {
  const path = window.location.pathname;

  useEffect(() => {
    if (path === "/") {
      window.location.replace("/login");
    }
  }, [path]);

  if (path === "/") {
    return null;
  }
  if (path.startsWith("/profile")) {
    return (
      <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
        <ZitadelSession project={project} postSignOutUrl="/login" />
      </div>
    );
  }
  if (path.startsWith("/register")) {
    return (
      <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
        <ZitadelLogin project={project} purpose="register" postSignInUrl="/profile" />
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelLogin project={project} purpose="login" postSignInUrl="/profile" />
    </div>
  );
}
`;
}
