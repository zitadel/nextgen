/**
 * The `.gitignore` `sv create`'s minimal template writes, at the version setup
 * runs it: its env lines except `.env.example` and `.env.test` before nothing
 * else ignores them.
 */
export const SVELTEKIT_GITIGNORE =
  "node_modules\n\n# Output\n.output\n/.svelte-kit\n/build\n\n# Env\n.env\n.env.*\n!.env.example\n!.env.test\n\n# Vite\nvite.config.js.timestamp-*\nvite.config.ts.timestamp-*\n";

/**
 * `text` as a setup before this CLI left it: the lines it held for the files it
 * writes appended whole unless the same line was there, `!.env.example` among
 * them, so `.env*` landed after a generator's own `!.env.example`.
 *
 * @param text - The `.gitignore` the generator wrote.
 * @returns The file an older setup left.
 */
export function asAnOlderSetupLeft(text: string): string {
  const lines = text.split("\n");
  const missing = [".zitadel/secret", ".env*", "!.env.example"].filter((entry) => {
    return !lines.includes(entry);
  });
  return missing.length === 0 ? text : `${text}${missing.join("\n")}\n`;
}
