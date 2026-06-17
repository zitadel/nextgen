import { MANAGED_MARKER } from "../../../../paths";
import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.vue`: a minimal path-based router that renders the
 * `@zitadel/sdk-vue` widgets — a landing chooser at `/`, login at `/login`,
 * register at `/register`, and the logout widget at `/profile`. The managed marker lives in
 * the `<script setup>` block (a JS comment) so eject/doctor stay marker-aware.
 * The project id comes from `VITE_ZITADEL_PROJECT_ID`. No secret reaches the
 * browser: the dev proxy in `vite.config.*` attaches the project service-key
 * secret (from `ZITADEL_PROJECT_SECRET`) server-side.
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
  <main
    v-if="path === '/'"
    style="min-height:100vh;padding:48px;display:flex;align-items:center;justify-content:center"
  >
    <section style="width:100%;max-width:560px">
      <p style="margin:0 0 12px;color:#4b5563;font-size:14px">Zitadel auth</p>
      <h1 style="margin:0 0 24px;font-size:32px;line-height:1.15">Sign in, create an account, or open your profile.</h1>
      <div style="display:flex;flex-wrap:wrap;gap:12px">
        <a href="/login" style="padding:10px 16px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">Sign in</a>
        <a href="/register" style="padding:10px 16px;border-radius:8px;border:1px solid #d1d5db;color:#111827;text-decoration:none;font-weight:600">Create account</a>
        <a href="/profile" style="padding:10px 16px;border-radius:8px;border:1px solid #d1d5db;color:#111827;text-decoration:none;font-weight:600">Profile</a>
      </div>
    </section>
  </main>
  <ZitadelLogout
    v-else-if="path.startsWith('/profile')"
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
