import { buildBrandingStylesheet } from "@zitadel/components";

import type { BrandingRevision, ThemeSide } from "./branding-palette";

/**
 * The `--zl-*` values a revision sets for one side, as `<zitadel-login>`
 * adopts them: its own stylesheet, read back into declarations so they can
 * go on an element's `style`, where no value can reach past that element.
 * The shared block (type, shape) comes first, the side's palette over it.
 */
export function brandingVariables(
  revision: BrandingRevision | undefined,
  side: ThemeSide,
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [, selector, body] of buildBrandingStylesheet(revision).matchAll(
    /([^{}]+)\{([^}]*)\}/g,
  )) {
    const scope = selector?.trim() ?? "";
    const shared = scope.startsWith(":host,");
    if (!shared && scope !== `:host([data-theme="${side}"])`) continue;
    for (const [, name, value] of (body ?? "").matchAll(/(--zl-[\w-]+)\s*:\s*([^;]+);/g)) {
      if (name && value) variables[name] = value.trim();
    }
  }
  return variables;
}
