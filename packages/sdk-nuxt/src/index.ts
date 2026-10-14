// Client-safe entry: page `<script setup>` blocks import from here, so it
// carries no server middleware (that is `@zitadel/sdk-nuxt/server`) and
// re-exports no element classes. The module registers no elements either: the
// app does, in a client-only plugin that imports `@zitadel/components` (the
// scaffold writes `app/plugins/zitadel-components.client.ts`).
// `businessLocales` is re-exported so scaffolded pages can wire the business
// copy overlay without a direct @zitadel/components dependency (strict package
// managers reject those). It comes from the components root, so importing this
// entry evaluates the element classes too: in the browser that defines the
// elements, on the server the definition is skipped.
export { businessLocales } from "@zitadel/components";
export { useZitadelProject } from "./runtime/composables/useZitadelProject.js";
export type {
  NextgenMiddlewareOptions,
  AuthResult,
  UnauthReason,
  ClientAuthResult,
  ClientAuthState,
  ClientSession,
} from "./runtime/types.js";
