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
    style="position:fixed;inset:0;padding:48px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:#0f0f11;color-scheme:dark;color:#f4f4f6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;letter-spacing:normal;text-align:center"
  >
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
  <div
    v-else-if="path.startsWith('/profile')"
    style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark"
  >
    <ZitadelLogout :project="project" postSignOutUrl="/login" />
  </div>
  <div
    v-else-if="path.startsWith('/register')"
    style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark"
  >
    <ZitadelLogin :project="project" purpose="register" postSignInUrl="/profile" />
  </div>
  <div v-else style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelLogin :project="project" purpose="login" postSignInUrl="/profile" />
  </div>
</template>
`;
}
