/**
 * The types and constants of a branding descriptor: what one holds, and how a
 * descriptor written before `$file` references named its template.
 */

import type { brandingConfigSchema } from "@zitadel/config/schemas";

import type { ContractValue } from "@/lib/zitadel/resources/document";

/**
 * What a branding descriptor holds once the branding contract took its body.
 */
export type BrandingValue = ContractValue<typeof brandingConfigSchema>;

/**
 * The key descriptors used before `$file` references.
 *
 * @remarks
 * Still recognised, so the finding can say how to migrate instead of
 * reporting an unknown key.
 */
export const LEGACY_TEMPLATE_FILE_KEY = "liquid_template_file";

/**
 * Where a legacy descriptor's template is taken to be when its key does not
 * name a path.
 */
export const DEFAULT_TEMPLATE_PATH = "./login.liquid";
