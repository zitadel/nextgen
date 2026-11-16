import type { ConfigFile } from "@/lib/zitadel";
import { aFile } from "@tests/helpers/config";

/**
 * A branding file at `.zitadel/branding/brand.json` whose template is a
 * `$file` reference, for a test of how a store resolves one.
 *
 * @param ref - The reference as written, relative to `.zitadel/branding/`.
 * @returns The file.
 */
export function aBrandingReferencing(ref: string): ConfigFile {
  return aFile("branding", "brand.json", { liquid_template: { $file: ref } });
}
