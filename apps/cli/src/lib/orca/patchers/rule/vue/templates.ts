import { MANAGED_MARKER } from "../../../../paths";
import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.vue`: a minimal path-based router that renders the
 * `@zitadel/sdk-vue` widgets — login at `/login`, register at `/register`, and
 * the signed-in session card at `/profile`. The root path redirects to `/login`.
 * The managed marker lives in the `<script setup>` block (a JS comment) so
 * eject/doctor stay marker-aware. The project id comes from
 * `VITE_ZITADEL_PROJECT_ID`. No secret reaches the browser: the dev proxy in
 * `vite.config.*` attaches the project service-key secret (from
 * `ZITADEL_PROJECT_SECRET`) server-side.
 */
export function appTemplate(): string {
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { ZitadelLogin, ZitadelSession, configureZitadel } from "@zitadel/sdk-vue";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

const path = window.location.pathname;
if (path === "/") {
  window.location.replace("/login");
}
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
    <ZitadelLogin :project="project" purpose="register" postSignInUrl="/profile" />
  </div>
  <div v-else-if="path !== '/'" style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelLogin :project="project" purpose="login" postSignInUrl="/profile" />
  </div>
</template>
`;
}
