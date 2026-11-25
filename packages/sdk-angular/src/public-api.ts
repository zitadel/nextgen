/*
 * Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
 * The edge build of the components package has no elements, so this does nothing there.
 */
import "@zitadel/components";

export { ZitadelLogin } from "./lib/zitadel-login.component.js";
export { ZitadelLogout } from "./lib/zitadel-logout.component.js";
export { ZitadelSession } from "./lib/zitadel-session.component.js";
export type {
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
} from "./lib/types.js";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
// The shared SPA widget types, named one by one so the public surface is a
// deliberate list and core's internals (widget tags, standard-attribute
// helpers, event-name constants) never leak through.
export type {
  ZitadelFlowPurpose,
  ZitadelFlowStep,
  ZitadelFlowBehavior,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-core/types";

/*
 * Re-exported so scaffolded apps can wire the business copy overlay without a
 * direct @zitadel/components dependency (strict package managers reject those).
 */
export { businessLocales } from "@zitadel/components";
