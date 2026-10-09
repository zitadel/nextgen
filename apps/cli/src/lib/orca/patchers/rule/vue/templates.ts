import { MANAGED_MARKER } from "../../../../paths";
import type { PatchContext } from "../../types";
import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.vue`: a minimal path-based router that renders the
 * `@zitadel/sdk-vue` widgets — login at `/login`, register at `/register`, and
 * the signed-in session card at `/profile`. The root path redirects to `/login`.
 * The managed marker lives in the `<script setup>` block (a JS comment) so
 * eject/doctor stay marker-aware. The project id comes from
 * `VITE_ZITADEL_PROJECT_ID`. No secret reaches the browser: the dev proxy in
 * `vite.config.*` attaches the project service-key secret (from
 * `ZITADEL_PROJECT_SECRET`) server-side only to `POST /sessions/exchange`.
 *
 * Projects set up with the business use case additionally pass the SDK's
 * `businessLocales` overlay to the login widgets, restoring work-email copy on
 * top of the widget's neutral built-in dictionaries. A plain `:locales` prop
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
// the login widget's neutral built-in dictionaries. Remove the :locales prop
// to fall back to the neutral wording.`
    : "";
  const localesAttr = business ? ' :locales="businessLocales"' : "";
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { onMounted } from "vue";
import { ${importNames} } from "@zitadel/sdk-vue";${localesComment}

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

const path = window.location.pathname;

onMounted(() => {
  if (path === "/") {
    window.location.replace("/login");
  }
});
</script>

<template>
  <div
    v-if="path.startsWith('/profile')"
    style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark"
  >
    <ZitadelSession :project="project" postSignOutUrl="/login" />
  </div>
  <div
    v-else-if="path.startsWith('/register')"
    style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark"
  >
    <ZitadelLogin :project="project"${localesAttr} purpose="register" postSignInUrl="/profile" />
  </div>
  <div v-else-if="path !== '/'" style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelLogin :project="project"${localesAttr} purpose="login" postSignInUrl="/profile" />
  </div>
</template>
`;
}
