export { ZitadelLoginComponent } from "./lib/zitadel-login.component";
export { ZitadelLogoutComponent } from "./lib/zitadel-logout.component";
export { ZitadelSessionComponent } from "./lib/zitadel-session.component";
// The same SDK config every SPA SDK re-exports: `configureZitadel` writes the
// global handle a widget without `[project]` falls back to, and `getApi` builds
// the client (with the publishable key, if set) for direct API calls.
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
// The shared SPA widget types, re-exported wholesale so this surface can never
// drift from the core contract (a new type is picked up automatically).
export type * from "@zitadel/sdk-core/types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
