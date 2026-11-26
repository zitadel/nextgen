/**
 * The bundled default template, compiled at build time.
 *
 * `templates/default.liquid` is parsed by LiquidJS while the package builds
 * and emitted as a plain render function (`vite-liquid-plugin.ts`), so a page
 * that keeps the default template never loads the engine. Only a tenant's
 * `branding.liquid_template` loads `liquid.ts`, which renders the same source
 * with the same filters; `default-template.spec.ts` holds the two to the same
 * bytes.
 *
 * This module must not import `liquidjs` or `@zitadel/config/template`
 * (which imports it): either would put the engine back on the default path.
 */
import { mandatoryGatesMarkerComment } from "./mandatory-gates.js";
import type { LiquidContext } from "./template-context.js";
import type { TemplateFilter } from "./template-runtime.js";
import renderCompiled from "./templates/default.liquid?compiled";

/**
 * The custom tags the default template uses. The key is
 * `MANDATORY_GATES_TAG` from `@zitadel/config/template`, written out so this
 * module stays free of LiquidJS; the build fails if the template's tag and
 * this name disagree.
 */
const TAGS = {
  mandatory_gates: () => mandatoryGatesMarkerComment,
};

/**
 * Renders the default template.
 *
 * @param context - The step as the template reads it.
 * @param filters - The dialect's filters for the active locale
 *   (`createTemplateFilters`).
 * @returns The rendered HTML, before mandatory gates are patched and the
 *   result is sanitised.
 */
export function renderDefaultTemplate(
  context: LiquidContext,
  filters: Readonly<Record<string, TemplateFilter>>,
): string {
  return renderCompiled(context, filters, TAGS);
}
