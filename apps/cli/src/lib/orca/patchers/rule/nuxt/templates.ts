import { MANAGED_MARKER } from "../../../../paths";

const MAIN_STYLE =
  "min-height: 100vh; background: #0f0f11";

/** `app.vue` — renders the page router. Marker in an HTML comment. */
export function appVueTemplate(): string {
  return `<!-- ${MANAGED_MARKER} -->
<template>
  <NuxtPage />
</template>

<style>
body {
  margin: 0;
  font-family: sans-serif;
}
</style>
`;
}

/** `pages/index.vue` — the landing chooser linking to login/register/profile. */
export function indexPageTemplate(): string {
  return `<!-- ${MANAGED_MARKER} -->
<template>
  <main style="position:fixed;inset:0;padding:48px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:#ffffff;color:#111827;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;letter-spacing:normal">
    <section style="width:100%;max-width:560px">
      <p style="margin:0 0 12px;color:#4b5563;font-size:14px">Zitadel auth</p>
      <h1 style="margin:0 0 24px;font-size:32px;line-height:1.15;font-weight:600;color:#111827">Sign in, create an account, or open your profile.</h1>
      <div style="display:flex;flex-wrap:wrap;gap:12px">
        <NuxtLink to="/login" style="padding:10px 16px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px">Sign in</NuxtLink>
        <NuxtLink to="/register" style="padding:10px 16px;border-radius:8px;border:1px solid #d1d5db;color:#111827;text-decoration:none;font-weight:600;font-size:14px">Create account</NuxtLink>
        <NuxtLink to="/profile" style="padding:10px 16px;border-radius:8px;border:1px solid #d1d5db;color:#111827;text-decoration:none;font-weight:600;font-size:14px">Profile</NuxtLink>
      </div>
    </section>
  </main>
</template>
`;
}

/** A login/register page rendering `<zitadel-login>` inside `<ClientOnly>`. */
function authPage(purpose: "login" | "register"): string {
  const purposeAttr = purpose === "register" ? '\n        purpose="register"' : "";
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const project = useZitadelProject();
</script>

<template>
  <main style="${MAIN_STYLE}">
    <ClientOnly>
      <zitadel-login
        :project="project"${purposeAttr}
        post-sign-in-url="/profile"
      />
    </ClientOnly>
  </main>
</template>
`;
}

export function loginPageTemplate(): string {
  return authPage("login");
}

export function registerPageTemplate(): string {
  return authPage("register");
}

/** `pages/profile.vue` — the signed-in view with the logout widget. */
export function profilePageTemplate(): string {
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const project = useZitadelProject();
</script>

<template>
  <main style="padding: 24px">
    <h1>Signed in (Nuxt)</h1>
    <ClientOnly>
      <zitadel-logout :project="project" post-sign-out-url="/login" />
    </ClientOnly>
  </main>
</template>
`;
}

/** `plugins/zitadel-components.client.ts` — register the Lit elements client-side. */
export function componentsPluginTemplate(): string {
  return `${MANAGED_MARKER}
// Register Lit custom elements on the client only. Importing @zitadel/components
// from a page <script setup> would run during SSR and break the widgets.
import "@zitadel/components";

export default defineNuxtPlugin(() => {});
`;
}

/** `plugins/auth.server.ts` — seed the client auth state from the server context. */
export function authPluginTemplate(): string {
  return `${MANAGED_MARKER}
import { defineNuxtPlugin, useRequestEvent, useState } from "#imports";
import type { ClientAuthResult } from "@zitadel/sdk-nuxt";

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? {
    isAuthenticated: false as const,
    session: null,
  };

  // Strip the raw JWT before seeding useState — it must not appear in the SSR
  // payload where client-side scripts could read it.
  const clientAuth: ClientAuthResult = auth.isAuthenticated
    ? {
        isAuthenticated: true,
        session: {
          userId: auth.session.userId,
          email: auth.session.email,
          name: auth.session.name,
        },
      }
    : { isAuthenticated: false, session: null };

  useState<ClientAuthResult>("nextgen-auth", () => clientAuth);
});
`;
}
