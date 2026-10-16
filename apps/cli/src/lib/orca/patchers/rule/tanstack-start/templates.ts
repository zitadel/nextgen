import { MANAGED_MARKER } from "../../../../paths";

import type { PatchContext } from "../../types";
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
 *
 * `createCsrfMiddleware` is listed first and kept explicitly: TanStack Start
 * only auto-installs its CSRF protection for server functions when the app has
 * no `src/start.ts`. Writing this file opts out of that default, so we restore
 * it here (ahead of auth, so cross-site requests are rejected before any
 * session work runs) rather than silently dropping CSRF protection.
 */
export function startTemplate(): string {
  return `${MANAGED_MARKER}
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { createNextgenRequestMiddleware } from "@zitadel/sdk-tanstack-start/server";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const authMiddleware = createMiddleware({ type: "request" }).server(
  createNextgenRequestMiddleware({
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, authMiddleware],
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
 * proxy). The wrapper mounts the widget on the client only, after hydration, so
 * it starts its flow with these props in place.
 *
 * Projects set up with the business use case additionally pass the SDK's
 * `businessLocales` overlay to the widget, restoring work-email copy on top of
 * the widget's neutral built-in dictionaries.
 */
function authRoute(purpose: "login" | "register", ctx: PatchContext): string {
  const path = purpose === "login" ? "/login" : "/register";
  const componentName = purpose === "login" ? "LoginPage" : "RegisterPage";
  const business = ctx.useCase === "business";
  const reactImports = business ? "ZitadelLogin, businessLocales" : "ZitadelLogin";
  const localesComment = business
    ? `

// Set up for a business audience: businessLocales overlays work-email copy on
// the login widget's neutral built-in dictionaries. Remove the locales prop to
// fall back to the neutral wording.`
    : "";
  const localesAttr = business ? " locales={businessLocales}" : "";
  return `${MANAGED_MARKER}
import { createFileRoute } from "@tanstack/react-router";
import { ${reactImports} } from "@zitadel/sdk-tanstack-start/react";
import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";${localesComment}

const projectId = import.meta.env.VITE_ZITADEL_PROJECT_ID ?? "";

const project = configureZitadel({ projectId, proxyPath: "${PROXY_PATH}" });

export const Route = createFileRoute("${path}")({
  component: ${componentName},
});

function ${componentName}() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelLogin project={project}${localesAttr} purpose="${purpose}" postSignInUrl="/profile" />
    </div>
  );
}
`;
}

export function loginRouteTemplate(ctx: PatchContext): string {
  return authRoute("login", ctx);
}

export function registerRouteTemplate(ctx: PatchContext): string {
  return authRoute("register", ctx);
}

/**
 * `src/routes/profile.tsx` — the signed-in view: the "signed in as" session card, with sign-out.
 *
 * `protectedRoutes` in `src/start.ts` only guards document requests: a
 * client-side `<Link to="/profile">` never reaches the request middleware. So
 * the route also guards itself in `beforeLoad` by calling a server function —
 * the call always goes to the server, where the request middleware has put the
 * session on the server function's context (a route's own `beforeLoad` context
 * does not carry it).
 */
export function profileRouteTemplate(): string {
  return `${MANAGED_MARKER}
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ZitadelSession } from "@zitadel/sdk-tanstack-start/react";
import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";
import { getClientAuth } from "@zitadel/sdk-tanstack-start/server";

const projectId = import.meta.env.VITE_ZITADEL_PROJECT_ID ?? "";

const project = configureZitadel({ projectId, proxyPath: "${PROXY_PATH}" });

// Runs on the server on every navigation, client-side ones included. Its
// return value is sent to the browser, so it returns the auth state without
// the session token, which stays in the HttpOnly cookie.
const fetchAuth = createServerFn().handler(({ context }) => getClientAuth(context));

export const Route = createFileRoute("/profile")({
  beforeLoad: async () => {
    const auth = await fetchAuth();
    if (!auth.isAuthenticated) {
      // The session could not be checked (the auth backend is down): an
      // error, not a sign-in prompt, since the visitor may well be signed in.
      if (auth.reason === "unavailable") throw new Error("Try again shortly");
      throw redirect({ to: "/login" });
    }
  },
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelSession project={project} postSignOutUrl="/login" />
    </div>
  );
}
`;
}
