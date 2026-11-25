import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fakerFile = resolve(packageRoot, "src/generated/endpoints/zitadelNextGen.faker.ts");

/** The directive that stops TypeScript checking a file. */
export const NOCHECK = "// @ts-nocheck";

/**
 * Put `// @ts-nocheck` on top of a generated faker module, once.
 *
 * @param source - The module's text as orval wrote it.
 * @returns The same text with the directive first.
 */
export function withNoCheck(source: string): string {
  if (source.startsWith(NOCHECK)) {
    return source;
  }
  return `${NOCHECK}\n${source}`;
}

/**
 * Orval 8.48 spreads every member of an event union into one mock object, so
 * `payload` gets `slug?: undefined` where the type is `{ [key: string]: never }`
 * and the file no longer compiles. The mocks are sample data, so the generated
 * faker module is left unchecked until orval stops emitting that.
 *
 * @returns Nothing; the module is rewritten in place.
 */
export async function markFakerUnchecked(): Promise<void> {
  await writeFile(fakerFile, withNoCheck(await readFile(fakerFile, "utf8")));
}
