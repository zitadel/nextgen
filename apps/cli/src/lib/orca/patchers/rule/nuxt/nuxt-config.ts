import { builders } from "magicast";

import { ConfigModule } from "@/lib/orca/patchers/rule/utils/config-module";

const NUXT_MODULE = "@zitadel/sdk-nuxt/module";

/**
 * Builds the pure `edit` transform the file-writer applies to the project's Nuxt
 * config (`nuxt.config.*`): registers the `@zitadel/sdk-nuxt` module (which wires
 * the server-side proxy + session middleware), sets the login path and the
 * protected route, and marks the `zitadel-*` Lit elements as custom elements for
 * the Vue compiler — preserving the user's existing config via magicast. The
 * backend URL and the project id stay out of the config: the module reads
 * `ZITADEL_URL` and `NUXT_PUBLIC_ZITADEL_PROJECT_ID` from the environment or
 * `.env.local`, where setup writes them, so a changed `.env.local` takes effect.
 * Idempotent. Throws `E_VALIDATION` when the file is absent or
 * `defineNuxtConfig` cannot be reached.
 */
export function nuxtConfigEdit(): (source: string | undefined) => string {
  return (source) => {
    const label = "the Nuxt config (nuxt.config.*)";
    const file = ConfigModule.open(source, label);
    const config = file.exportedObject();

    config.modules ??= [];
    const modules = file.arrayAt(config, "modules");
    const addsModule = !modules.includes(NUXT_MODULE);
    if (addsModule) {
      modules.push(NUXT_MODULE);
    }

    config.nextgen ??= {};
    const nextgen = file.objectAt(config, "nextgen");
    const addsLoginPath = nextgen.loginPath === undefined;
    if (addsLoginPath) {
      nextgen.loginPath = "/login";
    }
    const addsProtectedRoutes = nextgen.protectedRoutes === undefined;
    if (addsProtectedRoutes) {
      nextgen.protectedRoutes = ["/profile"];
    }

    // Tell Vue's template compiler the `zitadel-*` Lit elements are custom
    // elements, not Vue components, so it renders them as native elements
    // instead of logging "Failed to resolve component" and mis-binding props.
    config.vue ??= {};
    const vue = file.objectAt(config, "vue");
    vue.compilerOptions ??= {};
    const compilerOptions = file.objectAt(vue, "compilerOptions");
    const addsCustomElement = compilerOptions.isCustomElement === undefined;
    if (addsCustomElement) {
      compilerOptions.isCustomElement = builders.raw(`(tag) => tag.startsWith("zitadel-")`);
    }
    const changed = addsModule || addsLoginPath || addsProtectedRoutes || addsCustomElement;

    // Nothing was missing — return the source untouched so the file-writer skips
    // it instead of letting magicast reformat an already-patched config.
    return file.render(changed);
  };
}
