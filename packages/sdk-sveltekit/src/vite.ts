import { loadEnv, type Plugin } from "vite";

/** The prefix of the settings `createNextgenHandle` reads from `process.env`. */
const ENV_PREFIX = "ZITADEL_";

/**
 * The values this plugin put on `process.env`. Vite restarts the dev server
 * when an env file changes and runs the plugin again in the same process, so
 * a value still equal to the one written here is the plugin's own to replace
 * or remove; any other value came from the environment and stays.
 */
const written = new Map<string, string>();

/**
 * Vite plugin that puts the app's `ZITADEL_*` settings from its env files
 * (`.env`, `.env.local`, `.env.[mode].local`, where `zitadel setup` writes them)
 * on `process.env` while `vite dev` runs, as Next.js and Nitro do on their own.
 * SvelteKit loads env files only into its `$app/env` modules, which carry just
 * the variables an app declares, so without this `createNextgenHandle`'s
 * defaults would miss them in dev. A variable the environment already sets
 * wins. Builds are left alone: in production the platform sets the variables.
 *
 * Add it to `vite.config.ts`:
 *
 * ```ts
 * import { sveltekit } from "@sveltejs/kit/vite";
 * import { zitadel } from "@zitadel/sdk-sveltekit/vite";
 * import { defineConfig } from "vite";
 *
 * export default defineConfig({
 *   plugins: [sveltekit(), zitadel()],
 * });
 * ```
 *
 * @returns A Vite plugin that applies to the dev server only.
 */
export function zitadel(): Plugin {
  return {
    name: "zitadel:env",
    apply: "serve",
    configResolved(config) {
      // Before loadEnv, which lets process.env override the env files.
      for (const [name, value] of written) {
        if (process.env[name] === value) {
          delete process.env[name];
        }
      }
      written.clear();
      for (const [name, value] of Object.entries(loadEnv(config.mode, config.envDir, ENV_PREFIX))) {
        if (process.env[name] === undefined) {
          process.env[name] = value;
          written.set(name, value);
        }
      }
    },
  };
}
