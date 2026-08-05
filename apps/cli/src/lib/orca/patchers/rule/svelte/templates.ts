import { MANAGED_MARKER } from "../../../../paths";

import type { PatchContext } from "../../types";
import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.svelte`: a minimal path-based router that renders the
 * `@zitadel/sdk-svelte` widgets — login at `/login`, register at `/register`, and
 * the signed-in session card at `/profile`. The root path redirects to `/login`.
 * The managed marker lives in the `<script lang="ts">` block (a JS comment) so
 * eject/doctor stay marker-aware. The project id comes from
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
  return `<script lang="ts">
${MANAGED_MARKER}
import { onMount } from "svelte";
import { ${importNames} } from "@zitadel/sdk-svelte";${localesComment}

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

const path = window.location.pathname;

onMount(() => {
  if (path === "/") {
    window.location.replace("/login");
  }
});
</script>

{#if path.startsWith("/profile")}
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelSession {project} postSignOutUrl="/login" />
  </div>
{:else if path.startsWith("/register")}
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelLogin {project}${localesAttr} purpose="register" postSignInUrl="/profile" />
  </div>
{:else if path !== "/"}
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelLogin {project}${localesAttr} purpose="login" postSignInUrl="/profile" />
  </div>
{/if}
`;
}
