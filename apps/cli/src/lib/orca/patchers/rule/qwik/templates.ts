import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/app.tsx`: a minimal path-based router that renders the
 * `@zitadel/sdk-qwik` widgets — a landing chooser at `/`, login at `/login`,
 * register at `/register`, and the logout widget at `/profile`. Exports a named `App`
 * (`component$`) to match the create-vite Qwik entry (`main.tsx` imports
 * `{ App }`). The project id comes from `VITE_ZITADEL_PROJECT_ID`. No secret
 * reaches the browser: the dev proxy in `vite.config.*` attaches the project
 * service-key secret (from `ZITADEL_PROJECT_SECRET`) server-side.
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

  if (path === "/") {
    return (
      <main style={{ minHeight: "100vh", padding: "48px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <section style={{ width: "100%", maxWidth: "560px" }}>
          <p style={{ margin: "0 0 12px", color: "#4b5563", fontSize: "14px" }}>Zitadel auth</p>
          <h1 style={{ margin: "0 0 24px", fontSize: "32px", lineHeight: "1.15" }}>Sign in, create an account, or open your profile.</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            <a href="/login" style={{ padding: "10px 16px", borderRadius: "8px", background: "#111827", color: "#ffffff", textDecoration: "none", fontWeight: "600" }}>Sign in</a>
            <a href="/register" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #d1d5db", color: "#111827", textDecoration: "none", fontWeight: "600" }}>Create account</a>
            <a href="/profile" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #d1d5db", color: "#111827", textDecoration: "none", fontWeight: "600" }}>Profile</a>
          </div>
        </section>
      </main>
    );
  }
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
