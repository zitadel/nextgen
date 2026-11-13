import { viteProxyEdit } from "@/lib/orca/patchers/rule/vite-support";

/** A Vite config as create-vite leaves it, before setup merged anything into it. */
export const BARE_VITE_CONFIG =
  'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n';

/** What setup's proxy reads the server's address with. */
const SERVER_ADDRESS = 'loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_URL';

/** The statement setup's proxy refuses to start without the address with, at `indent`. */
function serverAddressCheck(indent: string): string {
  return `${indent}if (!${SERVER_ADDRESS}) {
${indent}  throw new Error("ZITADEL_URL is not set; add it to .env.local (zitadel setup writes it).");
${indent}}
`;
}

/** {@link BARE_VITE_CONFIG} with the `/__nextgen` proxy setup merges into it on port 5173. */
export function viteConfig(): string {
  return viteProxyEdit(5173)(BARE_VITE_CONFIG);
}

/**
 * `config` as setup wrote it before the proxy read `ZITADEL_URL`: its target
 * fixes `address`, and `configure(proxy)` does not check for the variable.
 */
export function withFixedAddress(config: string, address: string): string {
  const indent =
    /^([\t ]*)if \(!loadEnv\("development", process\.cwd\(\), "ZITADEL_"\)\.ZITADEL_URL\)/m.exec(
      config,
    )?.[1];
  const check = serverAddressCheck(indent ?? "");
  if (
    indent === undefined ||
    !config.includes(check) ||
    !config.includes(`target: ${SERVER_ADDRESS},`)
  ) {
    throw new Error("expected the proxy to read ZITADEL_URL");
  }
  return config
    .replace(check, "")
    .replace(`target: ${SERVER_ADDRESS},`, `target: ${JSON.stringify(address)},`);
}
