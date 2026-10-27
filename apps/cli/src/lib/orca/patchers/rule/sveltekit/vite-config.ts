import { ZitadelError } from "../../../../errors";
import { readBalanced } from "../utils/read-balanced";

const PLUGIN_MODULE = "@zitadel/sdk-sveltekit/vite";
const PLUGIN_IMPORT = `import { zitadel } from "${PLUGIN_MODULE}";`;
const PLUGIN_CALL = /\bzitadel\(\s*\)/;
const SVELTEKIT_CALL = "sveltekit(";
const SVELTEKIT_IMPORT = /^import[^;]*from\s*["']@sveltejs\/kit\/vite["'];?[^\n]*\n/m;

/**
 * Builds the pure `edit` transform the file-writer applies to a SvelteKit
 * project's `vite.config.*`: adds the `zitadel()` plugin from
 * `@zitadel/sdk-sveltekit/vite` right after the `sveltekit()` plugin, with its
 * import after the `@sveltejs/kit/vite` one. In dev the plugin puts the
 * `ZITADEL_*` settings from `.env.local` on `process.env`, where the hook's
 * defaults read them; SvelteKit itself never does.
 *
 * Like the SolidStart edit, this is a small source transform rather than a
 * magicast edit, so the rest of the config keeps its formatting. Each half is
 * added only when missing, so it is idempotent. Throws `E_VALIDATION` when the
 * file is absent or has no `sveltekit()` plugin call.
 */
export function svelteKitViteConfigEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      throw new ZitadelError(
        "E_VALIDATION",
        "Cannot edit the SvelteKit Vite config: file not found",
        {
          hint: "Run setup from a SvelteKit project that has a vite.config.ts.",
        },
      );
    }

    let result = source;
    if (!PLUGIN_CALL.test(result)) {
      const callIndex = result.indexOf(SVELTEKIT_CALL);
      if (callIndex === -1) {
        throw new ZitadelError(
          "E_VALIDATION",
          "Cannot add the zitadel() plugin: no sveltekit() plugin call found in the Vite config",
          {
            hint: `Add zitadel() from ${PLUGIN_MODULE} to the plugins in vite.config.ts.`,
          },
        );
      }
      const { end } = readBalanced(result, callIndex + SVELTEKIT_CALL.length - 1);
      result = `${result.slice(0, end)}, zitadel()${result.slice(end)}`;
    }

    if (!result.includes(PLUGIN_MODULE)) {
      const kitImport = SVELTEKIT_IMPORT.exec(result);
      const at = kitImport ? kitImport.index + kitImport[0].length : 0;
      result = `${result.slice(0, at)}${PLUGIN_IMPORT}\n${result.slice(at)}`;
    }

    return result;
  };
}
