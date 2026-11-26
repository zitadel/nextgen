/**
 * The custom Liquid tags of the login-template dialect, as names only.
 *
 * Apart from `template.ts`, which holds the authoring validator and so
 * imports LiquidJS: what renders a template in the browser registers these
 * tags without loading the validator, or LiquidJS before it needs it.
 */

/** The `{% mandatory_gates %}` runtime safety-net tag every template must emit. */
export const MANDATORY_GATES_TAG = "mandatory_gates";

/**
 * Custom Liquid tags the login orchestrator registers beyond the standard
 * set. Validators must register them (as no-ops) or parsing valid templates
 * fails; `@zitadel/components` registers the real implementations.
 */
export const TEMPLATE_TAGS = [MANDATORY_GATES_TAG] as const;
