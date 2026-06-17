import { MANAGED_MARKER } from "../../../../paths";
import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.vue`: a minimal path-based router that renders the
 * `@zitadel/sdk-vue` widgets — login at `/login` (and `/`), register at
 * `/register`, and the logout widget at `/profile`. The managed marker lives in
 * the `<script setup>` block (a JS comment) so eject/doctor stay marker-aware.
 * The project id comes from `VITE_ZITADEL_PROJECT_ID`. No secret reaches the
 * browser: the dev proxy in `vite.config.*` attaches the `sk_<project_id>`
 * bearer (derived from the public project id) server-side.
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
  <!-- Enforce the dark surface the Zitadel widgets are designed for, so the
       page never follows the OS light/dark setting. -->
  <main style="min-height: 100vh; background: #0f0f11; color: #f4f4f6; color-scheme: dark;">
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
  </main>
</template>
`;
}
