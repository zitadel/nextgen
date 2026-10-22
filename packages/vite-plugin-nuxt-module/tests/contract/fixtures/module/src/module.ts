import {
  addComponent,
  addComponentsDir,
  addImports,
  addImportsDir,
  addLayout,
  addPlugin,
  addPluginTemplate,
  addRouteMiddleware,
  addServerHandler,
  addServerImports,
  addServerImportsDir,
  addServerPlugin,
  addServerScanDir,
  addServerTemplate,
  addTemplate,
  addTypeTemplate,
  addVitePlugin,
  createResolver,
  defineNuxtModule,
  extendPages,
  extendRouteRules,
  extendViteConfig,
  findPath,
  getNuxtVersion,
  isNuxtMajorVersion,
  resolveFiles,
  resolvePath,
  setGlobalHead,
  updateAppConfig,
  useLogger,
  useNuxt,
} from "@nuxt/kit";

import { DEFAULT_GREETING, greetingFor } from "./shared";

/** What the app can set under `helloTiming` in its `nuxt.config`. */
export interface ModuleOptions {
  /** The greeting every message starts with. */
  greeting: string;
  /** The prefix of the module's API routes. */
  prefix: string;
  /** The name of the `Server-Timing` metric every response carries. */
  timingLabel: string;
  /** The path the module's route middleware sends to `/hello`. */
  secretPath: string;
  /** A value that stays in the server's private runtime config. */
  secret: string;
}

/** The context the `hello-timing:setup` hook hands to the app. */
export interface SetupContext {
  greetings: string[];
}

/** The build hooks the module adds to Nuxt. */
export interface ModuleHooks {
  "hello-timing:setup": (context: SetupContext) => void | Promise<void>;
}

/** The runtime hooks the module adds to the Nuxt app. */
export interface ModuleRuntimeHooks {
  "hello-timing:greeted": (message: string) => void;
}

/** The module's public runtime config. */
export interface ModulePublicRuntimeConfig {
  helloTiming: Pick<ModuleOptions, "greeting" | "prefix" | "timingLabel" | "secretPath"> & {
    greetings: string[];
    nuxtVersion: string;
    nuxtMajor4: boolean;
    extraComponents: number;
  };
}

/** The module's private runtime config. */
export interface ModuleRuntimeConfig {
  helloTiming: Pick<ModuleOptions, "secret">;
}

declare module "@nuxt/schema" {
  interface NuxtHooks extends ModuleHooks {}
}

/** The id of the build, read from the Nuxt instance in scope rather than passed in. */
function currentBuildId(): string {
  return useNuxt().options.buildId;
}

const defaults: ModuleOptions = {
  greeting: DEFAULT_GREETING,
  prefix: "/api/hello-timing",
  timingLabel: "hello",
  secretPath: "/secret",
  secret: "",
};

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "hello-timing",
    configKey: "helloTiming",
    compatibility: { nuxt: ">=4" },
  },
  defaults,
  // The options' shape, for tools that read it without running the module.
  schema: defaults,
  hooks: {
    "hello-timing:setup": (context) => {
      context.greetings.push("from the module hook");
    },
  },
  async setup(options, nuxt) {
    const logger = useLogger("hello-timing");
    const { resolve } = createResolver(import.meta.url);
    logger.info(greetingFor("Nuxt", options.greeting));

    // A custom build hook: the app adds its own greeting to the module's.
    const context: SetupContext = { greetings: [greetingFor("setup", options.greeting)] };
    await nuxt.callHook("hello-timing:setup", context);

    // Runtime config: public reaches the browser, the secret stays on the server.
    const extraComponents = await resolveFiles(resolve("./runtime/components/extra"), "*.vue");
    nuxt.options.runtimeConfig.public.helloTiming = {
      greeting: options.greeting,
      prefix: options.prefix,
      timingLabel: options.timingLabel,
      secretPath: options.secretPath,
      greetings: context.greetings,
      nuxtVersion: getNuxtVersion(nuxt),
      nuxtMajor4: isNuxtMajorVersion(4, nuxt),
      extraComponents: extraComponents.length,
    };
    nuxt.options.runtimeConfig.helloTiming = { secret: options.secret };
    updateAppConfig({ helloTiming: { title: "Hello Timing" } });
    setGlobalHead({ title: "Hello Timing" });

    // Components, composables, a plugin and route middleware.
    addComponent({
      name: "HelloBanner",
      filePath: resolve("./runtime/components/HelloBanner.vue"),
    });
    addComponentsDir({
      path: resolve("./runtime/components/extra"),
      prefix: "Hello",
      pathPrefix: false,
    });
    addImports({ name: "useGreeting", from: resolve("./runtime/composables/useGreeting") });
    addImportsDir(resolve("./runtime/composables/auto"));
    addPlugin(resolve("./runtime/plugin"));
    addPluginTemplate({
      filename: "hello-timing-template-plugin.mjs",
      getContents: () =>
        `import { defineNuxtPlugin } from "#imports";\nexport default defineNuxtPlugin(() => ({ provide: { helloTemplate: ${JSON.stringify(options.greeting)} } }));\n`,
    });
    addRouteMiddleware({
      name: "hello-redirect",
      path: resolve("./runtime/middleware/redirect"),
      global: true,
    });

    // A page the module owns, in a layout the module owns.
    extendPages((pages) => {
      pages.push({
        name: "hello-timing",
        path: "/hello",
        file: resolve("./runtime/pages/hello.vue"),
      });
    });
    const layout = await findPath(resolve("./runtime/layouts/hello"), { extensions: [".vue"] });
    if (!layout) throw new Error("hello-timing: the hello layout is missing");
    addLayout(layout, "hello");
    extendRouteRules("/hello", { headers: { "x-hello-rule": "1" } });

    // Nitro: a route, middleware that times every response, a Nitro plugin and auto-imports.
    addServerHandler({
      route: `${options.prefix}/hello`,
      handler: resolve("./runtime/server/api/hello"),
    });
    addServerHandler({ middleware: true, handler: resolve("./runtime/server/middleware/timing") });
    addServerPlugin(resolve("./runtime/server/plugin"));
    addServerScanDir(resolve("./runtime/server-scan"));
    addServerImports([{ name: "helloGreeting", from: resolve("./runtime/server/utils/greeting") }]);
    addServerImportsDir(resolve("./runtime/server/utils/auto"));
    addServerTemplate({
      filename: "#hello-timing/virtual",
      getContents: () => `export const BUILD = ${JSON.stringify(currentBuildId())};\n`,
    });
    nuxt.hook("nitro:config", (nitroConfig) => {
      nitroConfig.alias ||= {};
      nitroConfig.alias["#hello-timing-greeting"] = resolve("./runtime/server/utils/greeting");
    });

    // A generated file, its alias and its types.
    const template = addTemplate({
      filename: "hello-timing.mjs",
      write: true,
      getContents: () =>
        `export const generated = ${JSON.stringify({ greeting: options.greeting, prefix: options.prefix })};\n`,
    });
    nuxt.options.alias["#hello-timing"] = template.dst;
    // Types: a script file declares the modules that exist only at build time, and a module file
    // augments the ones that exist already.
    addTypeTemplate({
      filename: "types/hello-timing-modules.d.ts",
      getContents: () =>
        [
          'declare module "#hello-timing" {',
          "  export const generated: { greeting: string; prefix: string };",
          "}",
          'declare module "#hello-timing/virtual" {',
          "  export const BUILD: string;",
          "}",
          'declare module "virtual:hello-timing" {',
          "  export const builtBy: string;",
          "}",
          "",
        ].join("\n"),
    });
    addTypeTemplate({
      filename: "types/hello-timing-app.d.ts",
      getContents: () =>
        [
          'declare module "#app" {',
          "  interface NuxtApp {",
          "    $hello: string;",
          "    $helloTemplate: string;",
          "  }",
          "}",
          "export {};",
          "",
        ].join("\n"),
    });

    // The stylesheet the plugin compiled from Sass, and a build-time constant.
    nuxt.options.css.push(
      await resolvePath(resolve("./runtime/assets/hello"), { extensions: [".css"] }),
    );
    addVitePlugin({
      name: "hello-timing:virtual",
      resolveId: (id) => (id === "virtual:hello-timing" ? "\0virtual:hello-timing" : undefined),
      load: (id) =>
        id === "\0virtual:hello-timing" ? 'export const builtBy = "vite-plugin";' : undefined,
    });
    extendViteConfig((config) => {
      config.define = { ...config.define, __HELLO_TIMING_BUILD__: JSON.stringify("contract") };
    });
  },
});
