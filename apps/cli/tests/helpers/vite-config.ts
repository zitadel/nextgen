import { viteProxyEdit } from "@/lib/orca/patchers/rule/vite-support";

/** A Vite config as create-vite leaves it, before setup merged anything into it. */
export const BARE_VITE_CONFIG =
  'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n';

/** {@link BARE_VITE_CONFIG} with the `/__nextgen` proxy setup merges into it on port 5173 for `server`. */
export function viteConfig(server: string): string {
  return viteProxyEdit(5173, server)(BARE_VITE_CONFIG);
}

/** The target setup writes: `ZITADEL_URL`, then the fallback it carries as a string literal. */
const SERVER_ADDRESS_TARGET = /target: \(\(url\) => \{[\s\S]*?\|\| "[^"]*"\),\n(?:[\t ]*\n)?/;

/**
 * `config` without its blank lines: recast sets a multi-line property apart
 * with one when it prints a new entry, which an edit in place does not add.
 */
export function withoutBlankLines(config: string): string {
  return config.replace(/\n[\t ]*(?=\n)/g, "");
}

/**
 * `config` as setup wrote it before the proxy read `ZITADEL_URL`: a v3 entry
 * whose target fixes `address`.
 */
export function withFixedAddress(config: string, address: string): string {
  if (!SERVER_ADDRESS_TARGET.test(config) || !config.includes("/* zitadel:proxy:v4 */")) {
    throw new Error("expected the v4 proxy that reads ZITADEL_URL");
  }
  return config
    .replace(SERVER_ADDRESS_TARGET, `target: ${JSON.stringify(address)},\n`)
    .replace("/* zitadel:proxy:v4 */", "/* zitadel:proxy:v3 */");
}
