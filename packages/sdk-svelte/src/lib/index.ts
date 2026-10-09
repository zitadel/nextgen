export { default as ZitadelLogin } from "./ZitadelLogin.svelte";
export { default as ZitadelLogout } from "./ZitadelLogout.svelte";
export { default as ZitadelSession } from "./ZitadelSession.svelte";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
export * from "./types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
