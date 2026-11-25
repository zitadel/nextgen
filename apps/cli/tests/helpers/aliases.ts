import { resolve } from "node:path";

/**
 * `tsconfig.app.json`'s `@/*` and `@tests/*`, for every Vitest config that
 * loads the CLI's source. `@tests` comes first so `@` does not claim it.
 */
export const aliases = {
  "@tests": resolve(import.meta.dirname, ".."),
  "@": resolve(import.meta.dirname, "../../src"),
};
