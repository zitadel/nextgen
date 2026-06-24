import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

// Enforce the dark surface the Zitadel widgets are designed for, so pages never
// follow the OS light/dark setting.
const WIDGET_WRAP =
  "position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark";

/**
 * `src/routes/plugin@nextgen.ts` — the Qwik City root `onRequest` plugin.
 * `createNextgenOnRequest` proxies `/__nextgen/*` to the auth backend (attaching
 * the project service-key from `ZITADEL_PROJECT_SECRET`), verifies the session
 * JWT, and redirects unauthenticated requests away from protected routes. `url`
 * and `projectSecret` default from `process.env` (seeded in `.env.local`), so
 * only the route policy is spelled out here. The managed marker sits in a JS
 * comment.
 */
export function pluginTemplate(): string {
  return `${MANAGED_MARKER}
import { createNextgenOnRequest } from "@zitadel/sdk-qwik-city/server";

export const onRequest = createNextgenOnRequest({
  protectedRoutes: ["/profile"],
  loginPath: "/login",
});
`;
}

/** `src/routes/index.tsx` — the landing chooser linking to login/register/profile. */
export function indexPageTemplate(): string {
  return `${MANAGED_MARKER}
import { component$ } from "@builder.io/qwik";

export default component$(() => (
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
));
`;
}

/**
 * A login/register page. Renders the idiomatic `<ZitadelLogin>` Qwik component
 * from `@zitadel/sdk-qwik` (typed props, callback events). `configureZitadel`
 * returns the project handle at module scope; the public project id comes from
 * `PUBLIC_ZITADEL_PROJECT_ID` via Qwik's `import.meta.env`.
 */
function authPage(purpose: "login" | "register"): string {
  return `${MANAGED_MARKER}
import { component$ } from "@builder.io/qwik";
import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-qwik";

const project = configureZitadel({
  projectId: import.meta.env.PUBLIC_ZITADEL_PROJECT_ID ?? "",
  proxyPath: "${PROXY_PATH}",
});

export default component$(() => {
  return (
    <div style="${WIDGET_WRAP}">
      <ZitadelLogin project={project} purpose="${purpose}" postSignInUrl="/profile" />
    </div>
  );
});
`;
}

export function loginPageTemplate(): string {
  return authPage("login");
}

export function registerPageTemplate(): string {
  return authPage("register");
}

/** `src/routes/profile/index.tsx` — the signed-in view with the logout widget. */
export function profilePageTemplate(): string {
  return `${MANAGED_MARKER}
import { component$ } from "@builder.io/qwik";
import { ZitadelLogout, configureZitadel } from "@zitadel/sdk-qwik";

const project = configureZitadel({
  projectId: import.meta.env.PUBLIC_ZITADEL_PROJECT_ID ?? "",
  proxyPath: "${PROXY_PATH}",
});

export default component$(() => {
  return (
    <div style="${WIDGET_WRAP}">
      <ZitadelLogout project={project} postSignOutUrl="/login" />
    </div>
  );
});
`;
}
