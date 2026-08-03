import { MANAGED_MARKER } from "../../../../paths";

import type { PatchContext } from "../../types";
import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/app.tsx`: a minimal path-based router that renders the
 * `@zitadel/sdk-qwik` widgets — login at `/login`, register at `/register`, and
 * the signed-in session card at `/profile`. The root path redirects to `/login`.
 * Exports a named `App` (`component$`) to match the create-vite Qwik entry
 * (`main.tsx` imports `{ App }`). The project id comes from
 * `VITE_ZITADEL_PROJECT_ID`. No secret reaches the browser: the dev proxy in
 * `vite.config.*` attaches the project service-key secret (from
 * `ZITADEL_PROJECT_SECRET`) server-side only to `POST /sessions/exchange`.
 *
 * Projects set up with the business use case additionally pass the SDK's
 * `businessLocales` overlay to the login widgets, restoring work-email copy on
 * top of the widget's neutral built-in dictionaries. A plain `locales` prop
 * suffices here: the wrapper component assigns it as a DOM property internally.
 */
export function appTemplate(ctx: PatchContext): string {
  const business = ctx.useCase === "business";
  const importNames = business
    ? "ZitadelLogin, ZitadelSession, businessLocales, configureZitadel"
    : "ZitadelLogin, ZitadelSession, configureZitadel";
  // The overlay ships with the SDK, so the generated app only wires it up
  // (and stays plain otherwise).
  const localesComment = business
    ? `

// Set up for a business audience: businessLocales overlays work-email copy on
// the login widget's neutral built-in dictionaries. Remove the locales prop to
// fall back to the neutral wording.`
    : "";
  const localesAttr = business ? " locales={businessLocales}" : "";
  return `${MANAGED_MARKER}
import { component$, useVisibleTask$ } from "@builder.io/qwik";
import { ${importNames} } from "@zitadel/sdk-qwik";${localesComment}

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
        <ZitadelLogin project={project}${localesAttr} purpose="register" postSignInUrl="/profile" />
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", inset: "0", overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelLogin project={project}${localesAttr} purpose="login" postSignInUrl="/profile" />
    </div>
  );
});
`;
}
