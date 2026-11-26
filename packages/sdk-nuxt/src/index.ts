/*
 * Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
 * The edge build of the components package has no elements, so this does nothing there.
 */
import "@zitadel/components";

/*
 * Re-exported so scaffolded apps can wire the business copy overlay without a
 * direct @zitadel/components dependency (strict package managers reject those).
 */
export { businessLocales } from "@zitadel/components";

export { createZitadelMiddleware, getAuth } from "./server.js";
export { useZitadelProject } from "./runtime/composables/useZitadelProject.js";
export type { ZitadelProject } from "@zitadel/sdk-core/config";
export type {
  ZitadelMiddlewareOptions,
  ZitadelAuthResult,
  ZitadelAuthSession,
  ZitadelAuthState,
  ZitadelUnauthState,
  ZitadelClientAuthResult,
} from "./runtime/types.js";
