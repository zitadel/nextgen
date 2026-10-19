import { MANAGED_MARKER } from "../../../../paths";
import type { PatchContext } from "../../types";

/** `app.vue` — renders the page router. Marker in an HTML comment. */
export function appVueTemplate(): string {
  return `<!-- ${MANAGED_MARKER} -->
<template>
  <NuxtPage />
</template>

<style>
:root {
  color-scheme: dark;
}
body {
  margin: 0;
  background: #0f0f11;
  color: #f4f4f6;
  font-family: sans-serif;
}
</style>
`;
}

/** `pages/index.vue` — redirects the app root to `/login`. */
export function indexPageTemplate(): string {
  return `<script setup lang="ts">
${MANAGED_MARKER}
await navigateTo("/login", { replace: true });
</script>
`;
}

/**
 * The `<script setup>` every page shares. It imports nothing: the module
 * auto-imports `useZitadelProject`, and an import from `@zitadel/sdk-nuxt`'s
 * root would evaluate the Lit elements during SSR, which only the client
 * plugin may load.
 */
const PROJECT_SETUP = "const project = useZitadelProject();";

/**
 * A login/register page rendering `<zitadel-login>` inside `<ClientOnly>`.
 * Business-use-case projects additionally bind the `businessLocales` overlay,
 * restoring work-email copy on top of the widget's neutral built-in
 * dictionaries. The overlay comes from the client components plugin, which
 * loads `@zitadel/components` in the browser only (see
 * {@link componentsPluginTemplate}). A plain `:locales` binding suffices even
 * on the raw custom element: Vue sets bindings whose key exists on the element
 * as DOM properties (unlike React 18, which is why the Next template needs a
 * ref).
 */
function authPage(purpose: "login" | "register", ctx: PatchContext): string {
  const business = ctx.useCase === "business";
  // The overlay ships with the components, so the generated page only wires
  // it up (and stays plain otherwise).
  const localesSetup = business
    ? `
// Set up for a business audience: businessLocales overlays work-email copy on
// the login widget's neutral built-in dictionaries. Remove the :locales
// binding to fall back to the neutral wording. The overlay is provided by
// plugins/zitadel-components.client.ts, so it is set in the browser, where
// <ClientOnly> renders the widget.
const { $zitadelBusinessLocales: businessLocales } = useNuxtApp();`
    : "";
  const localesAttr = business ? '\n        :locales="businessLocales"' : "";
  const purposeAttr = purpose === "register" ? '\n        purpose="register"' : "";
  // Posture (ADR 044): page posture paints the widget's full-page chrome and
  // pins the color scheme via the <main> wrapper; widget posture embeds the
  // card in the host app's own layout inside a layout-neutral centered <div>.
  const widget = ctx.posture === "widget";
  const variantAttrs = widget ? 'variant="widget"\n        theme="auto"' : 'variant="page"';
  const postureComment = widget
    ? `<!-- variant="widget" embeds the card in this app's own layout.
           theme="auto" follows the OS light/dark preference
           (prefers-color-scheme), not the app's own theme — set
           theme="light" or theme="dark" to match an app that pins its
           scheme. variant="page" would paint the widget's full-page
           chrome instead. -->`
    : `<!-- variant="page" paints the widget's full-page chrome from design
           tokens; variant="widget" embeds the card inside a layout you own. -->`;
  const wrapperOpen = widget
    ? '<div style="display: flex; justify-content: center; padding: 4rem 1rem">'
    : '<main style="color-scheme: dark">';
  const wrapperClose = widget ? "</div>" : "</main>";
  return `<script setup lang="ts">
${MANAGED_MARKER}
${PROJECT_SETUP}${localesSetup}
</script>

<template>
  ${wrapperOpen}
    <ClientOnly>
      ${postureComment}
      <zitadel-login
        ${variantAttrs}
        :project="project"${localesAttr}${purposeAttr}
        post-sign-in-url="/profile"
      />
    </ClientOnly>
  ${wrapperClose}
</template>
`;
}

export function loginPageTemplate(ctx: PatchContext): string {
  return authPage("login", ctx);
}

export function registerPageTemplate(ctx: PatchContext): string {
  return authPage("register", ctx);
}

/** `pages/profile.vue` — the post-sign-in "signed in as" session card. */
export function profilePageTemplate(ctx: PatchContext): string {
  // Same posture hinge as the auth pages (ADR 044).
  const widget = ctx.posture === "widget";
  const variantAttrs = widget ? 'variant="widget"\n        theme="auto"' : 'variant="page"';
  const postureComment = widget
    ? `<!-- variant="widget" embeds the session card in this app's own layout.
           theme="auto" follows the OS light/dark preference
           (prefers-color-scheme), not the app's own theme — set
           theme="light" or theme="dark" to match an app that pins its
           scheme. variant="page" would paint the card's full-page chrome
           instead. Your own components (a header, an account menu) read
           the same session state with the auto-imported useAuth()
           composable. -->`
    : `<!-- variant="page" paints the session card's full-page chrome from design
           tokens; variant="widget" embeds the card inside a layout you own.
           Your own components (a header, an account menu) read the same session
           state with the auto-imported useAuth() composable. -->`;
  const wrapperOpen = widget
    ? '<div style="display: flex; justify-content: center; padding: 4rem 1rem">'
    : '<main style="color-scheme: dark">';
  const wrapperClose = widget ? "</div>" : "</main>";
  const element = widget
    ? `<zitadel-session
        ${variantAttrs}
        :project="project"
        post-sign-out-url="/login"
      />`
    : `<zitadel-session variant="page" :project="project" post-sign-out-url="/login" />`;
  return `<script setup lang="ts">
${MANAGED_MARKER}
${PROJECT_SETUP}
</script>

<template>
  ${wrapperOpen}
    <ClientOnly>
      ${postureComment}
      ${element}
    </ClientOnly>
  ${wrapperClose}
</template>
`;
}

/**
 * `plugins/zitadel-components.client.ts` — register the Lit elements
 * client-side. `@zitadel/components` is a direct dependency of the app (the
 * patcher adds it), so the import resolves under strict package managers too.
 * Business-use-case projects also provide the `businessLocales` overlay to the
 * pages, which must not import the components themselves.
 */
export function componentsPluginTemplate(ctx: Pick<PatchContext, "useCase">): string {
  const header = `${MANAGED_MARKER}
// Register Lit custom elements on the client only. Importing @zitadel/components
// from a page <script setup> would run during SSR and break the widgets.`;
  if (ctx.useCase === "business") {
    return `${header}
import { businessLocales } from "@zitadel/components";

// Pages read it as useNuxtApp().$zitadelBusinessLocales.
export default defineNuxtPlugin(() => ({
  provide: { zitadelBusinessLocales: businessLocales },
}));
`;
  }
  return `${header}
import "@zitadel/components";

export default defineNuxtPlugin(() => {});
`;
}

/**
 * The client plugin older CLIs wrote: it registered the elements and provided
 * nothing. `--fix` refreshes an unedited copy so a restored business page finds
 * the locales provider it reads (see {@link componentsPluginTemplate}).
 */
export const LEGACY_COMPONENTS_PLUGIN = `${MANAGED_MARKER}
// Register Lit custom elements on the client only. Importing @zitadel/components
// from a page <script setup> would run during SSR and break the widgets.
import "@zitadel/components";

export default defineNuxtPlugin(() => {});
`;
