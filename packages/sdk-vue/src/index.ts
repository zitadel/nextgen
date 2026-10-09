export { default as ZitadelLogin } from "./components/ZitadelLogin";
export { default as ZitadelLogout } from "./components/ZitadelLogout";
export { default as ZitadelSession } from "./components/ZitadelSession";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
export * from "./types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
