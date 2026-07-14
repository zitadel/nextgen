import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/app.tsx`: a minimal path-based router that renders the
 * `@zitadel/sdk-qwik` widgets — login at `/login`, register at `/register`, and
 * the signed-in session card at `/profile`. The root path redirects to `/login`.
 * Exports a named `App` (`component$`) to match the create-vite Qwik entry
 * (`main.tsx` imports `{ App }`). The project id comes from
 * `VITE_ZITADEL_PROJECT_ID`. No secret reaches the browser: the dev proxy in
 * `vite.config.*` attaches the project service-key secret (from
 * `ZITADEL_PROJECT_SECRET`) server-side.
 */
export function appTemplate(): string {
  return `${MANAGED_MARKER}
import { component$, useVisibleTask$ } from "@builder.io/qwik";
import { ZitadelLogin, ZitadelSession, configureZitadel } from "@zitadel/sdk-qwik";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

export const App = component$(() => {
  const path = window.location.pathname;

  useVisibleTask$(() => {
    if (path === "/") {
      window.location.replace("/login");
    }
  });

  if (path === "/") {
    return null;
  }
  if (path.startsWith("/profile")) {
    return (
      <div style={{ position: "fixed", inset: "0", overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
        <ZitadelSession project={project} postSignOutUrl="/login" />
      </div>
    );
  }
  if (path.startsWith("/register")) {
    return (
      <div style={{ position: "fixed", inset: "0", overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
        <ZitadelLogin project={project} purpose="register" postSignInUrl="/profile" />
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", inset: "0", overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelLogin project={project} purpose="login" postSignInUrl="/profile" />
    </div>
  );
});
`;
}
