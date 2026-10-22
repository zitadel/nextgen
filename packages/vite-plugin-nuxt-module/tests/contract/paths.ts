import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The package directory: Nuxt, `@nuxt/kit` and the rest of the tools resolve from its `node_modules`. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The fixture module (a Nuxt module's package) and the Nuxt app that installs it. */
export const FIXTURES = join(PACKAGE_ROOT, "tests/contract/fixtures");
