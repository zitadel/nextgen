/**
 * LiquidJS engine factory for the `<zitadel-login>` orchestrator.
 *
 * Configures the engine per the security pipeline in
 * `docs/design/flowengine/template-security.md` and registers the
 * dialect's filters (`template-filters.ts`) and the `{% mandatory_gates %}`
 * tag from `docs/design/branding/templates.md`.
 *
 * The orchestrator loads this module only for a tenant's
 * `branding.liquid_template`: the default template is compiled at build time
 * (`templates/default.liquid?compiled`) and renders without LiquidJS.
 *
 * Hard rules:
 *
 * - `{{ }}` output is HTML-escaped (LiquidJS default since v10).
 * - The `| raw` filter is overridden to a no-op string passthrough that still
 *   escapes (Layer 1 of the security pipeline).
 * - Partials are loaded from an in-memory map; no filesystem access.
 */
import { MANDATORY_GATES_TAG } from "@zitadel/config/template";
import { Liquid } from "liquidjs";

import type { Locale } from "./locales/en.js";
import { mandatoryGatesMarkerComment } from "./mandatory-gates.js";
import { createTemplateFilters } from "./template-filters.js";
import defaultTemplate from "./templates/default.liquid";

/**
 * The names the engine registers its in-memory templates under.
 */
export const TEMPLATE_NAMES = {
  default: "default",
} as const;

/**
 * Options for {@link createLiquidEngine}.
 */
export type CreateLiquidOptions = {
  /**
   * The dictionary the text filters read.
   */
  locale: Locale;
  /**
   * Additional in-memory templates merged on top of the bundled defaults.
   * Useful for tests and for tenant-supplied `branding.liquid_template`
   * (registered under {@link TEMPLATE_NAMES.default}).
   */
  templates?: Record<string, string>;
};

/**
 * Creates the engine that renders a tenant's template in the login dialect.
 *
 * @param options - The locale and any extra templates.
 * @returns The configured engine.
 */
export function createLiquidEngine(options: CreateLiquidOptions): Liquid {
  const templates: Record<string, string> = {
    [TEMPLATE_NAMES.default]: defaultTemplate,
    ...(options.templates ?? {}),
  };

  const engine = new Liquid({
    templates,
    cache: true,
    jsTruthy: true,
    relativeReference: false,
    strictFilters: false,
    strictVariables: false,
    outputEscape: "escape",
  });

  for (const [name, filter] of Object.entries(createTemplateFilters(options.locale))) {
    engine.registerFilter(name, filter);
  }

  // `{% mandatory_gates %}` — emits a unique marker comment that the
  // orchestrator post-processes via `patchMandatoryGates`. The tag name is
  // owned by @zitadel/config so the authoring validator registers the same
  // dialect this engine renders.
  engine.registerTag(MANDATORY_GATES_TAG, {
    parse() {
      // No body, no args — nothing to consume.
    },
    render() {
      return mandatoryGatesMarkerComment;
    },
  });

  return engine;
}
