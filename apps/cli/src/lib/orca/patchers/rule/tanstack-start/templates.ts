import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

// Enforce the dark surface the Zitadel widgets are designed for, so pages never
// follow the OS light/dark setting. Inlined as a React style object on each
// widget wrapper since TanStack Start routes render JSX.

/**
 * `src/start.ts` — the TanStack Start server entry that the framework auto-loads
 * (`#tanstack-start-entry`). It must export a `startInstance` from `createStart`;
 * we wire a global request middleware via `requestMiddleware`. The middleware is
 * built from `createNextgenRequestMiddleware`, which on every request proxies
 * `/__nextgen/*` to the auth backend (attaching the project service-key from
 * `ZITADEL_PROJECT_SECRET`), verifies the session JWT, and redirects
 * unauthenticated requests away from protected routes. `url` and `projectSecret`
 * default from `process.env` (seeded in `.env.local`), so only the route policy
 * is spelled out here. The managed marker sits in a JS comment.
 */
export function startTemplate(): string {
  return `${MANAGED_MARKER}
import { createMiddleware, createStart } from "@tanstack/react-start";
import { createNextgenRequestMiddleware } from "@zitadel/sdk-tanstack-start/server";

const authMiddleware = createMiddleware({ type: "request" }).server(
  createNextgenRequestMiddleware({
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [authMiddleware],
}));
`;
}

/** `src/routes/index.tsx` — the landing chooser linking to login/register/profile. */
export function indexRouteTemplate(): string {
  return `${MANAGED_MARKER}
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main style={{ position: "fixed", inset: 0, padding: "48px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f11", colorScheme: "dark", color: "#f4f4f6", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", lineHeight: 1.5, letterSpacing: "normal", textAlign: "center" }}>
      <section style={{ width: "100%", maxWidth: "560px" }}>
        <p style={{ margin: "0 0 12px", color: "#9ca3af", fontSize: "14px" }}>Zitadel auth</p>
        <h1 style={{ margin: "0 0 24px", fontSize: "32px", lineHeight: 1.15, fontWeight: 600, color: "#f4f4f6" }}>Sign in, create an account, or open your profile.</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center" }}>
          <Link to="/login" style={{ padding: "10px 16px", borderRadius: "8px", background: "#f4f4f6", color: "#0f0f11", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}>
            Sign in
          </Link>
          <Link to="/register" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #3f3f46", color: "#f4f4f6", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}>
            Create account
          </Link>
          <Link to="/profile" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #3f3f46", color: "#f4f4f6", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}>
            Profile
          </Link>
        </div>
      </section>
    </main>
  );
}
`;
}

/**
 * A login/register route. Configures the SDK once at module scope with
 * `configureZitadel` from the `/client` entry and passes the returned project
 * handle straight to the typed `<ZitadelLogin>` React wrapper from
 * `@zitadel/sdk-tanstack-start/react` as its `project` prop. The public project
 * id comes from Vite's `import.meta.env.VITE_ZITADEL_PROJECT_ID`; the backend URL
 * never reaches the browser (the widget talks to the same-origin `${PROXY_PATH}`
 * proxy).
 */
function authRoute(purpose: "login" | "register"): string {
  const path = purpose === "login" ? "/login" : "/register";
  const componentName = purpose === "login" ? "LoginPage" : "RegisterPage";
  return `${MANAGED_MARKER}
import { createFileRoute } from "@tanstack/react-router";
import { ZitadelLogin } from "@zitadel/sdk-tanstack-start/react";
import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";

const projectId = import.meta.env.VITE_ZITADEL_PROJECT_ID ?? "";

const project = configureZitadel({ projectId, proxyPath: "${PROXY_PATH}" });

export const Route = createFileRoute("${path}")({
  component: ${componentName},
});

function ${componentName}() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelLogin project={project} purpose="${purpose}" postSignInUrl="/profile" />
    </div>
  );
}
`;
}

export function loginRouteTemplate(): string {
  return authRoute("login");
}

export function registerRouteTemplate(): string {
  return authRoute("register");
}

/** `src/routes/profile.tsx` — the signed-in view with the logout widget. */
export function profileRouteTemplate(): string {
  return `${MANAGED_MARKER}
import { createFileRoute } from "@tanstack/react-router";
import { ZitadelLogout } from "@zitadel/sdk-tanstack-start/react";
import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";

const projectId = import.meta.env.VITE_ZITADEL_PROJECT_ID ?? "";

const project = configureZitadel({ projectId, proxyPath: "${PROXY_PATH}" });

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelLogout project={project} postSignOutUrl="/login" />
    </div>
  );
}
`;
}
