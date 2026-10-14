// Client-safe entry: page `<script setup>` blocks import from here, so it
// carries no server middleware (that is `@zitadel/sdk-nuxt/server`) and no Lit
// element classes (the module registers the elements in the browser).
// Re-exported so scaffolded pages can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
export { useZitadelProject } from "./runtime/composables/useZitadelProject.js";
export type {
  NextgenMiddlewareOptions,
  AuthResult,
  ClientAuthResult,
  ClientAuthState,
  ClientSession,
} from "./runtime/types.js";
