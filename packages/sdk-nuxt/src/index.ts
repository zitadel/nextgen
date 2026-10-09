export { ZitadelLogin, ZitadelLogout } from "@zitadel/components";
// Re-exported so scaffolded pages can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
export { createNextgenMiddleware, getAuth } from "./server.js";
export { useZitadelProject } from "./runtime/composables/useZitadelProject.js";
export type { NextgenMiddlewareOptions, AuthResult, ClientAuthResult } from "./runtime/types.js";
