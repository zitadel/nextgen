export {
  IMPLICIT_DEPENDENCY,
  MODULE_JSON,
  NODE_TARGET,
  NUXT_EXTENSION,
  NUXT_EXTENSIONS,
  NUXT_EXTERNALS,
  NUXT_MODULE_ENTRY,
  NUXT_RUNTIME_DIR,
  NUXT_SOURCEMAP,
  OUT_DIR,
  SOURCE_ROOT,
} from "./defaults.ts";
export type { EntryOption } from "./entries.ts";
export type { Matcher } from "./externals.ts";
export type { NuxtModuleOptions } from "./options.ts";
export { nuxtModule, nuxtModule as default } from "./plugin.ts";
