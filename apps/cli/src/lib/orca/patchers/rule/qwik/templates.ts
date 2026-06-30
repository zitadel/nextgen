import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/app.tsx`: a minimal path-based router that renders the
 * `@zitadel/sdk-qwik` widgets — a landing chooser at `/`, login at `/login`,
 * register at `/register`, and the signed-in session card at `/profile`. Exports a named `App`
 * (`component$`) to match the create-vite Qwik entry (`main.tsx` imports
 * `{ App }`). The project id comes from `VITE_ZITADEL_PROJECT_ID`. No secret
 * reaches the browser: the dev proxy in `vite.config.*` attaches the project
 * service-key secret (from `ZITADEL_PROJECT_SECRET`) server-side.
 */
export function appTemplate(): string {
  return `${MANAGED_MARKER}
import { component$ } from "@builder.io/qwik";
import { ZitadelLogin, ZitadelSession, configureZitadel } from "@zitadel/sdk-qwik";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

export const App = component$(() => {
  const path = window.location.pathname;

  if (path === "/") {
    return (
      <main style={{ position: "fixed", inset: "0", padding: "48px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f11", colorScheme: "dark", color: "#f4f4f6", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", lineHeight: "1.5", letterSpacing: "normal", textAlign: "center" }}>
        <section style={{ width: "100%", maxWidth: "560px" }}>
          <p style={{ margin: "0 0 12px", color: "#9ca3af", fontSize: "14px" }}>Zitadel auth</p>
          <h1 style={{ margin: "0 0 24px", fontSize: "32px", lineHeight: "1.15", fontWeight: "600", color: "#f4f4f6" }}>Sign in, create an account, or open your profile.</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center" }}>
            <a href="/login" style={{ padding: "10px 16px", borderRadius: "8px", background: "#f4f4f6", color: "#0f0f11", textDecoration: "none", fontWeight: "600", fontSize: "14px" }}>Sign in</a>
            <a href="/register" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #3f3f46", color: "#f4f4f6", textDecoration: "none", fontWeight: "600", fontSize: "14px" }}>Create account</a>
            <a href="/profile" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #3f3f46", color: "#f4f4f6", textDecoration: "none", fontWeight: "600", fontSize: "14px" }}>Profile</a>
          </div>
        </section>
      </main>
    );
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
