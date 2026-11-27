/**
 * The custom Liquid tags of the login templates, apart from the validator in
 * `template.ts` so a renderer can read their names without loading LiquidJS or
 * the validator.
 */

/** The `{% mandatory_gates %}` runtime safety-net tag every template must emit. */
export const MANDATORY_GATES_TAG = "mandatory_gates";

/**
 * Custom Liquid tags the login orchestrator registers beyond the standard
 * set. Validators must register them (as no-ops) or parsing valid templates
 * fails; `@zitadel/components` registers the real implementations.
 */
export const TEMPLATE_TAGS = [MANDATORY_GATES_TAG] as const;
