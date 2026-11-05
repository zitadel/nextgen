import { MANAGED_MARKER } from "../../../../paths";

import type { PatchContext } from "../../types";
import { PROXY_PATH } from "../proxy";

// Enforce the dark surface the Zitadel widgets are designed for, so pages never
// follow the OS light/dark setting.
const WIDGET_WRAP = "position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark";

/**
 * `src/middleware.ts` — the SolidStart middleware entrypoint. `createNextgenMiddleware`
 * returns a `{ onRequest: [...] }` config object that proxies `/__nextgen/*` to
 * the auth backend (attaching the project service-key from
 * `ZITADEL_PROJECT_SECRET`), verifies the session JWT, and redirects
 * unauthenticated requests away from protected routes. `url` and `projectSecret`
 * default from `process.env` (seeded in `.env.local`), so only the route policy
 * is spelled out here. The managed marker sits in a JS comment.
 *
 * SolidStart 2 imports this module's default export and registers it as an
 * array of h3 middleware (`middleware.map(...)`). The config object is wrapped
 * in SolidStart's own `createMiddleware`, which turns `{ onRequest }` into that
 * array — exporting the bare config would leave SolidStart with nothing to run,
 * so `/__nextgen/*` would 404. The SDK stays framework-agnostic; the wrap lives
 * here in the generated app.
 */
export function middlewareTemplate(): string {
  return `${MANAGED_MARKER}
import { createMiddleware } from "@solidjs/start/middleware";
import { createNextgenMiddleware } from "@zitadel/sdk-solid-start/server";

export default createMiddleware(
  createNextgenMiddleware({
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  }),
);
`;
}

/** `src/routes/index.tsx` — the landing chooser linking to login/register/profile. */
export function indexPageTemplate(): string {
  return `${MANAGED_MARKER}
export default function Index() {
  return (
    <main style="position:fixed;inset:0;padding:48px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:#0f0f11;color-scheme:dark;color:#f4f4f6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;letter-spacing:normal;text-align:center">
      <section style="width:100%;max-width:560px">
        <p style="margin:0 0 12px;color:#9ca3af;font-size:14px">Zitadel auth</p>
        <h1 style="margin:0 0 24px;font-size:32px;line-height:1.15;font-weight:600;color:#f4f4f6">Sign in, create an account, or open your profile.</h1>
        <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center">
          <a href="/login" style="padding:10px 16px;border-radius:8px;background:#f4f4f6;color:#0f0f11;text-decoration:none;font-weight:600;font-size:14px">Sign in</a>
          <a href="/register" style="padding:10px 16px;border-radius:8px;border:1px solid #3f3f46;color:#f4f4f6;text-decoration:none;font-weight:600;font-size:14px">Create account</a>
          <a href="/profile" style="padding:10px 16px;border-radius:8px;border:1px solid #3f3f46;color:#f4f4f6;text-decoration:none;font-weight:600;font-size:14px">Profile</a>
        </div>
      </section>
    </main>
  );
}
`;
}

/**
 * A login/register page rendering the `<ZitadelLogin>` widget from
 * `@zitadel/sdk-solid`, loaded with SolidStart's `clientOnly`. The widget module
 * imports `@zitadel/components`, which registers Lit custom elements by calling
 * `customElements.define` at import time — undefined during SSR, so a static
 * import would crash the server render and the page would come back empty.
 * `clientOnly` defers the import to the browser, so the route renders on the
 * server and the widget mounts after hydration (like Nuxt's `<ClientOnly>`).
 *
 * The public project id (`VITE_ZITADEL_PROJECT_ID`; Vite only exposes
 * `VITE_`-prefixed env to the client) and proxy path are passed as props rather
 * than a `configureZitadel` handle — building the handle here would require
 * importing `@zitadel/sdk-solid` at module scope, reintroducing the SSR crash.
 *
 * Projects set up with the business use case additionally pass the SDK's
 * `businessLocales` overlay to the widget, restoring work-email copy on top of
 * the widget's neutral built-in dictionaries. The overlay ships in the same
 * client-only module, so the loader wraps the widget to apply it.
 */
function authPage(purpose: "login" | "register", ctx: PatchContext): string {
  const business = ctx.useCase === "business";
  const loader = business
    ? `import type { ComponentProps } from "solid-js";

// Set up for a business audience: businessLocales overlays work-email copy on
// the login widget's neutral built-in dictionaries. Have the loader return the
// plain ZitadelLogin to fall back to the neutral wording.
const ZitadelLogin = clientOnly(() =>
  import("@zitadel/sdk-solid").then(({ ZitadelLogin: Login, businessLocales }) => ({
    default: (props: ComponentProps<typeof Login>) => (
      <Login {...props} locales={businessLocales} />
    ),
  })),
);`
    : `
const ZitadelLogin = clientOnly(() =>
  import("@zitadel/sdk-solid").then((m) => ({ default: m.ZitadelLogin })),
);`;
  return `${MANAGED_MARKER}
import { clientOnly } from "@solidjs/start";
${loader}

export default function ${purpose === "login" ? "Login" : "Register"}() {
  return (
    <main style="${WIDGET_WRAP}">
      <ZitadelLogin
        projectId={import.meta.env.VITE_ZITADEL_PROJECT_ID ?? ""}
        proxyPath="${PROXY_PATH}"
        purpose="${purpose}"
        postSignInUrl="/profile"
      />
    </main>
  );
}
`;
}

export function loginPageTemplate(ctx: PatchContext): string {
  return authPage("login", ctx);
}

export function registerPageTemplate(ctx: PatchContext): string {
  return authPage("register", ctx);
}

/**
 * `src/routes/profile.tsx` — the signed-in view: the "signed in as" session card, with sign-out. Loaded
 * with `clientOnly` for the same reason as the auth pages: `@zitadel/sdk-solid`
 * registers Lit custom elements at import time, which would crash SSR.
 */
export function profilePageTemplate(): string {
  return `${MANAGED_MARKER}
import { clientOnly } from "@solidjs/start";

const ZitadelSession = clientOnly(() =>
  import("@zitadel/sdk-solid").then((m) => ({ default: m.ZitadelSession })),
);

export default function Profile() {
  return (
    <main style="${WIDGET_WRAP}">
      <ZitadelSession
        projectId={import.meta.env.VITE_ZITADEL_PROJECT_ID ?? ""}
        proxyPath="${PROXY_PATH}"
        postSignOutUrl="/login"
      />
    </main>
  );
}
`;
}
