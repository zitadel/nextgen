/**
 * The authoritative login-template validator (ADR 040).
 *
 * Runs where authoring happens — `zitadel plan`/`apply`, and later editors —
 * against the same LiquidJS dialect `@zitadel/components` renders. The Go
 * server cannot parse this dialect faithfully, so it only mirrors the
 * lexical subset below (`internal/domain/branding_validator.go`, see the
 * `goRef` entries in {@link TEMPLATE_VALIDATION_RULES}); keep the two
 * pattern lists in sync.
 *
 * Render-time safety does not depend on this validator: the component
 * escapes all output, neuters `| raw`, sanitises via DOMPurify, and patches
 * missing required UI with `{% mandatory_gates %}`
 * (`docs/design/flowengine/template-security.md`).
 */
import { Liquid } from "liquidjs";

/** The `{% mandatory_gates %}` runtime safety-net tag every template must emit. */
export const MANDATORY_GATES_TAG = "mandatory_gates";

/**
 * Custom Liquid tags the login orchestrator registers beyond the standard
 * set. Validators must register them (as no-ops) or parsing valid templates
 * fails; `@zitadel/components` registers the real implementations.
 */
export const TEMPLATE_TAGS = [MANDATORY_GATES_TAG] as const;

/**
 * Byte cap for stored templates. Mirrors `maxLength` on
 * `branding.liquid_template` in the OpenAPI contract and
 * `MaxBrandingTemplateBytes` in the Go gate.
 */
export const MAX_TEMPLATE_BYTES = 131072;

export type TemplateValidationSeverity = "error" | "warning";

/**
 * Rule catalog with pointers into the Go lexical gate
 * (`internal/domain/branding_validator.go`) where a server-side mirror
 * exists. `parse` and `mandatory-gates` are authoring-only: the server
 * cannot check them (wrong dialect) and render-time behavior degrades
 * safely without them.
 */
export const TEMPLATE_VALIDATION_RULES = {
  parse: { goRef: null },
  size: { goRef: "MaxBrandingTemplateBytes" },
  "no-script-tag": { goRef: "brandingScriptTag" },
  "no-style-tag": { goRef: "brandingStyleTag" },
  "no-inline-handlers": { goRef: "brandingInlineHandler" },
  "no-javascript-urls": { goRef: "brandingJavascriptURL" },
  "no-raw-filter": { goRef: "brandingRawFilter" },
  "mandatory-gates": { goRef: null },
} as const;

export type TemplateValidationRuleId = keyof typeof TEMPLATE_VALIDATION_RULES;

export type TemplateValidationIssue = {
  severity: TemplateValidationSeverity;
  rule: TemplateValidationRuleId;
  message: string;
};

type BannedPattern = {
  rule: TemplateValidationRuleId;
  pattern: RegExp;
  message: string;
};

/**
 * Lexical bans, identical to the Go gate. The inline-handler pattern only
 * matches inside an open tag so Liquid like `{% assign online = true %}`
 * doesn't false-positive; its separator class includes `/` because HTML
 * treats a slash between attributes as whitespace (`<img/onerror=…>`).
 */
export const BANNED_TEMPLATE_PATTERNS: readonly BannedPattern[] = [
  {
    rule: "no-script-tag",
    pattern: /<\s*script\b/i,
    message: "Templates must not contain <script> tags.",
  },
  {
    rule: "no-style-tag",
    pattern: /<\s*style\b/i,
    message: "Templates must not contain <style> tags — theming is orchestrator-owned via tokens.",
  },
  {
    rule: "no-inline-handlers",
    pattern: /<[a-z][^>]*[\s/]on[a-z]+\s*=/i,
    message: "Templates must not contain inline event handlers (on*= attributes).",
  },
  {
    rule: "no-javascript-urls",
    pattern: /javascript\s*:/i,
    message: "Templates must not contain javascript: URLs.",
  },
  {
    rule: "no-raw-filter",
    pattern: /\|\s*raw\b/,
    message:
      "Templates must not use the | raw filter. The renderer neuters it anyway; remove it from the template.",
  },
] as const;

// Derived from the exported tag name so a rename cannot silently diverge
// the validator from the renderer contract.
const MANDATORY_GATES_PATTERN = new RegExp(`\\{%-?\\s*${MANDATORY_GATES_TAG}\\s*-?%\\}`);

let parseEngine: Liquid | undefined;

/**
 * A parse-only engine mirroring the orchestrator's dialect options
 * (`packages/components/src/orchestrator/liquid.ts`); custom tags are
 * registered as no-ops because only parseability matters here.
 */
function getParseEngine(): Liquid {
  if (!parseEngine) {
    const engine = new Liquid({
      cache: false,
      jsTruthy: true,
      relativeReference: false,
      strictFilters: false,
      strictVariables: false,
    });
    for (const tag of TEMPLATE_TAGS) {
      engine.registerTag(tag, {
        parse() {
          // no-op: the tag takes no arguments and no body
        },
        render() {
          return "";
        },
      });
    }
    parseEngine = engine;
  }
  return parseEngine;
}

/**
 * Validates a login template. Pure and non-throwing, like
 * `validateFlowDefinition`: returns an issue list, empty when the template
 * is valid.
 */
export function validateLoginTemplate(template: string): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];

  const bytes = new TextEncoder().encode(template).length;
  if (bytes > MAX_TEMPLATE_BYTES) {
    issues.push({
      severity: "error",
      rule: "size",
      message: `Template is ${bytes} bytes; the platform caps liquid_template at ${MAX_TEMPLATE_BYTES} bytes.`,
    });
  }

  for (const banned of BANNED_TEMPLATE_PATTERNS) {
    if (banned.pattern.test(template)) {
      issues.push({ severity: "error", rule: banned.rule, message: banned.message });
    }
  }

  if (!MANDATORY_GATES_PATTERN.test(template)) {
    issues.push({
      severity: "error",
      rule: "mandatory-gates",
      message:
        "Template must contain a trailing {% mandatory_gates %} tag — the runtime safety net that appends required fields, gates, and the submit action a template forgot to render.",
    });
  }

  try {
    getParseEngine().parse(template);
  } catch (error) {
    issues.push({
      severity: "error",
      rule: "parse",
      message: `Template is not valid LiquidJS: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return issues;
}
