// Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
// The edge build of the components package has no elements, so this does nothing there.
import "@zitadel/components";

export { ZitadelLoginComponent } from "./lib/zitadel-login.component.js";
export { ZitadelLogoutComponent } from "./lib/zitadel-logout.component.js";
export { ZitadelSessionComponent } from "./lib/zitadel-session.component.js";
export { configureZitadel } from "./lib/config.js";
export type { ZitadelConfig, ZitadelProject } from "./lib/config.js";
// The shared SPA widget types, re-exported wholesale so this surface can never
// drift from the core contract (a new type is picked up automatically).
export type * from "@zitadel/sdk-core/types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
