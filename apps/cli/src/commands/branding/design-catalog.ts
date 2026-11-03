import { BRANDING_DESIGNS, type BrandingDesign } from "@zitadel/config/defaults";

import { RETIRED_BRANDING_DESIGNS } from "../../lib/branding/designs";

/** The shipped designs, as a list for a hint to offer. */
export const DESIGN_CATALOG = BRANDING_DESIGNS.join(", ");

/** Whether `value` names a design the CLI ships. */
export function isBrandingDesign(value: string): value is BrandingDesign {
  return (BRANDING_DESIGNS as readonly string[]).includes(value);
}

/** Whether `value` names a design the CLI used to ship and retired. */
export function isRetiredDesign(value: string): boolean {
  return (RETIRED_BRANDING_DESIGNS as readonly string[]).includes(value);
}
