/**
 * Every export of `@nuxt/kit`, and what the contract fixture does with it. A module the plugin
 * builds is free to use any of them, so a new kit export (a Nuxt upgrade adds them) fails
 * `tests/kit-coverage.test.ts` until it is decided here:
 *
 * - `covered`: the fixture module (`fixtures/module/src/module.ts`) imports it, and `contract.spec.ts`
 *   asserts what it does in a running Nuxt app;
 * - `excluded`: it is not about building a module, or its effect cannot be seen in a production
 *   build of an app, with the reason.
 */
export type KitCoverage = "covered" | { readonly excluded: string };

const BUILD_TOOL = "programmatic entry point for tools that drive Nuxt, not for module setup";
const DIAGNOSTICS = "diagnostics for tooling that reports on a Nuxt project";
const OTHER_MODULES =
  "works with other modules, packages or installs, and the fixture module has none";
const NORMALIZER = "normalizer the add* functions call themselves";
const OTHER_BUNDLER = "the fixture app builds with Vite; the Vite path is covered";
const DEV_ONLY = "dev server only; the contract builds and serves a production app";
const CONSTANT = "a constant or path helper, with nothing to observe in a running app";

export const KIT_API: Readonly<Record<string, KitCoverage>> = {
  DEFAULT_JSX_FILE_EXTENSIONS: { excluded: CONSTANT },
  DEFAULT_JS_FILE_EXTENSIONS: { excluded: CONSTANT },
  addBuildPlugin: { excluded: "the unplugin wrapper over addVitePlugin and addWebpackPlugin" },
  addComponent: "covered",
  addComponentExports: { excluded: "addComponent for the named exports of one file" },
  addComponentsDir: "covered",
  addDevServerHandler: { excluded: DEV_ONLY },
  addImports: "covered",
  addImportsDir: "covered",
  addImportsSources: { excluded: "the preset form of addImports" },
  addLayout: "covered",
  addPlugin: "covered",
  addPluginTemplate: "covered",
  addPrerenderRoutes: {
    excluded: "a prerendered static route is byte-identical to the rendered one",
  },
  addRouteMiddleware: "covered",
  addRspackPlugin: { excluded: OTHER_BUNDLER },
  addServerHandler: "covered",
  addServerImports: "covered",
  addServerImportsDir: "covered",
  addServerPlugin: "covered",
  addServerScanDir: "covered",
  addServerTemplate: "covered",
  addTemplate: "covered",
  addTypeTemplate: "covered",
  addVitePlugin: "covered",
  addWebpackPlugin: { excluded: OTHER_BUNDLER },
  assertNuxtCompatibility: { excluded: "static compatibility metadata, recorded in module.json" },
  buildDiagnostics: { excluded: DIAGNOSTICS },
  buildNuxt: { excluded: BUILD_TOOL },
  bundlerDiagnostics: { excluded: DIAGNOSTICS },
  checkNuxtCompatibility: { excluded: "static compatibility metadata, recorded in module.json" },
  componentDiagnostics: { excluded: DIAGNOSTICS },
  configDiagnostics: { excluded: DIAGNOSTICS },
  createIsIgnored: { excluded: "reads the app's ignore patterns, which the fixture does not set" },
  createResolver: "covered",
  defineNuxtModule: "covered",
  directoryToURL: { excluded: CONSTANT },
  extendNuxtSchema: { excluded: "extends the schema tooling reads, not the running app" },
  extendPages: "covered",
  extendRouteRules: "covered",
  extendRspackConfig: { excluded: OTHER_BUNDLER },
  extendViteConfig: "covered",
  extendWebpackConfig: { excluded: OTHER_BUNDLER },
  findPath: "covered",
  getDirectory: { excluded: CONSTANT },
  getLayerDirectories: {
    excluded: "lists the layers' directories, and the fixture app has one layer",
  },
  getNuxtCtx: { excluded: "Nuxt context plumbing; setup is handed the instance" },
  getNuxtModuleVersion: { excluded: OTHER_MODULES },
  getNuxtVersion: "covered",
  hasNuxtCompatibility: { excluded: "static compatibility metadata, recorded in module.json" },
  hasNuxtModule: { excluded: OTHER_MODULES },
  hasNuxtModuleCompatibility: { excluded: OTHER_MODULES },
  headDiagnostics: { excluded: DIAGNOSTICS },
  importModule: { excluded: OTHER_MODULES },
  installModule: { excluded: OTHER_MODULES },
  installModules: { excluded: OTHER_MODULES },
  isIgnored: { excluded: "reads the app's ignore patterns, which the fixture does not set" },
  isNuxt2: { excluded: "legacy version check; isNuxtMajorVersion is covered" },
  isNuxt3: { excluded: "legacy version check; isNuxtMajorVersion is covered" },
  isNuxtMajorVersion: "covered",
  loadNuxt: { excluded: BUILD_TOOL },
  loadNuxtConfig: { excluded: BUILD_TOOL },
  loadNuxtModuleInstance: { excluded: OTHER_MODULES },
  logger: { excluded: "the consola instance useLogger wraps" },
  normalizeModuleTranspilePath: { excluded: NORMALIZER },
  normalizePlugin: { excluded: NORMALIZER },
  normalizeSemanticVersion: { excluded: NORMALIZER },
  normalizeTemplate: { excluded: NORMALIZER },
  nuxtCtx: { excluded: "Nuxt context plumbing; setup is handed the instance" },
  packageName: { excluded: CONSTANT },
  pageDiagnostics: { excluded: DIAGNOSTICS },
  pluginDiagnostics: { excluded: DIAGNOSTICS },
  recoverThrottledChanges: { excluded: DEV_ONLY },
  requireModule: { excluded: OTHER_MODULES },
  resolveAlias: { excluded: "resolves the aliases the fixture registers, which the app imports" },
  resolveDeclarationPath: { excluded: CONSTANT },
  resolveFiles: "covered",
  resolveIgnorePatterns: {
    excluded: "reads the app's ignore patterns, which the fixture does not set",
  },
  resolveModule: { excluded: OTHER_MODULES },
  resolveModuleWithOptions: { excluded: OTHER_MODULES },
  resolveNuxtModule: { excluded: OTHER_MODULES },
  resolvePath: "covered",
  resolveTypePaths: { excluded: CONSTANT },
  runWithNuxtContext: { excluded: "Nuxt context plumbing; setup is handed the instance" },
  setBuildOutput: { excluded: BUILD_TOOL },
  setGlobalHead: "covered",
  tryImportModule: { excluded: OTHER_MODULES },
  tryRequireModule: { excluded: OTHER_MODULES },
  tryResolveModule: { excluded: OTHER_MODULES },
  tryUseNuxt: { excluded: "Nuxt context plumbing; useNuxt is covered" },
  updateAppConfig: "covered",
  updateRuntimeConfig: {
    excluded: `${DEV_ONLY} (it updates a running Nitro and warns at build time)`,
  },
  updateTemplates: { excluded: DEV_ONLY },
  useLogger: "covered",
  useNitro: { excluded: "the Nitro instance exists only after the ready hook, after module setup" },
  useNuxt: "covered",
  useRuntimeConfig: { excluded: "reads the config at build time; the module writes it instead" },
  writeTypes: { excluded: BUILD_TOOL },
};
