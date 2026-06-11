import { MANAGED_MARKER } from "../../../../paths";
import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.vue`: a minimal path-based router that renders the
 * `@zitadel/sdk-vue` widgets — login at `/login` (and `/`), register at
 * `/register`, and the logout widget at `/profile`. The managed marker lives in
 * the `<script setup>` block (a JS comment) so eject/doctor stay marker-aware.
 * The project id comes from `VITE_ZITADEL_PROJECT_ID`; the secret is injected by
 * the dev proxy in `vite.config.ts` and never reaches the browser.
 */
export function appTemplate(): string {
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { ZitadelLogin, ZitadelLogout, configureZitadel } from "@zitadel/sdk-vue";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

const path = window.location.pathname;
</script>

<template>
  <ZitadelLogout
    v-if="path.startsWith('/profile')"
    :project="project"
    postSignOutUrl="/login"
  />
  <ZitadelLogin
    v-else-if="path.startsWith('/register')"
    :project="project"
    purpose="register"
    postSignInUrl="/profile"
  />
  <ZitadelLogin v-else :project="project" purpose="login" postSignInUrl="/profile" />
</template>
`;
}
