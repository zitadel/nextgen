import { z } from "zod";

/**
 * Input types accepted by an interactive `flow-field`. Mirrors the
 * `FlowField.type` enum in the OAS spec at
 * `api/openapi/endpoints/schemas/flow-field.yaml`.
 */
const fieldType = z.enum(["text", "email", "password", "tel", "number", "url", "date", "hidden"]);

/**
 * A localization key. Pattern enforces the convention
 * `<step>.<scope>.<name>` (snake-case segments) so locale scaffolding
 * can round-trip keys without ambiguity.
 */
const textKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "text_key must follow <step>.<scope>.<name>");

/**
 * A single field collected on a step. The renderer maps `type` to a
 * concrete input control; `text_key` resolves to the field label.
 */
const flowFieldSchema = z.object({
  type: fieldType,
  text_key: textKey,
  required: z.boolean().default(false),
  value: z.unknown().optional(),
  validation: z
    .object({
      format: z.string().optional(),
      pattern: z.string().optional(),
      min_length: z.number().int().optional(),
      max_length: z.number().int().optional(),
    })
    .optional(),
});

/**
 * A user-invokable action on a step (typically a button). `primary`
 * controls visual emphasis; the runtime never inspects more than one
 * primary per step.
 */
const flowActionSchema = z.object({
  text_key: textKey,
  primary: z.boolean().default(false),
});

/**
 * A pre-submit gate (today: captcha or passkey). Gates are evaluated
 * before the step's fields are accepted; failure pins the user on the
 * current step.
 */
const flowGateSchema = z.object({
  type: z.enum(["captcha", "passkey"]),
  provider: z.string().optional(),
  required: z.boolean().default(true),
  satisfied: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Localization keys for a step's display text. Both keys are optional
 * — a step may render purely from its fields and actions.
 */
const stepTextsSchema = z.object({
  title_key: textKey,
  description_key: textKey.optional(),
});

/**
 * A transition target. Either a sibling step name (string) or a pivot
 * into another flow purpose (`{ pivot: "<purpose>" }`).
 */
const transitionTarget = z.union([
  z.string().min(1),
  z.object({
    pivot: z.enum(["login", "register", "recovery", "profiling", "reauth", "link_account"]),
  }),
]);

/**
 * One node in the flow graph. `transitions` maps action/outcome names
 * to the next step; the engine walks this map after each submit.
 */
const stepDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "step name must be snake_case"),
  type: z.enum([
    "identifier",
    "credential",
    "form",
    "verification",
    "policy_check",
    "consent",
    "action",
    "info",
    "redirect",
    "captcha",
    "complete",
  ]),
  texts: stepTextsSchema.optional(),
  fields: z.record(z.string(), flowFieldSchema).default({}),
  actions: z.record(z.string(), flowActionSchema).default({}),
  gates: z.record(z.string(), flowGateSchema).default({}),
  transitions: z.record(z.string(), transitionTarget).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The on-disk shape per the OAS spec
 * `api/openapi/components/flows/flow-definition.yaml`. Required keys:
 * `name, user_schema, purposes, initial_steps, steps`. `name` is a
 * slug-pattern identifier and doubles as the display label — there is
 * no separate `slug` or `display_name`. `version`, `kind`, and
 * `template_name` are NOT in the spec; the CLI used to emit them but
 * no longer does.
 */
export const flowDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "name must match ^[a-z][a-z0-9-]*$"),
  user_schema: z.string().url(),
  purposes: z
    .array(z.enum(["login", "register", "recovery", "profiling", "reauth", "link_account"]))
    .nonempty(),
  initial_steps: z.record(z.string(), z.string()),
  audience: z
    .object({
      team_ids: z.array(z.string()).optional(),
      app_ids: z.array(z.string()).optional(),
      user_schema_ids: z.array(z.string()).optional(),
    })
    .optional(),
  steps: z.array(stepDefinitionSchema).nonempty(),
});

/** Parsed, validated flow-definition body. */
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
