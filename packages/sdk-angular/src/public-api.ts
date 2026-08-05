export { ZitadelLoginComponent } from "./lib/zitadel-login.component";
export { ZitadelLogoutComponent } from "./lib/zitadel-logout.component";
export { ZitadelSessionComponent } from "./lib/zitadel-session.component";
export { configureZitadel } from "./lib/config";
export type { ZitadelConfig, ZitadelProject } from "./lib/config";
// The shared SPA widget types, re-exported wholesale so this surface can never
// drift from the core contract (a new type is picked up automatically).
export type * from "@zitadel/sdk-core/types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
