import { z } from "zod";

const fieldType = z.enum(["text", "email", "password", "tel", "number", "url", "date", "hidden"]);

const textKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "text_key must follow <step>.<scope>.<name>");

export const flowFieldSchema = z.object({
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

export const flowActionSchema = z.object({
  text_key: textKey,
  primary: z.boolean().default(false),
});

export const flowGateSchema = z.object({
  type: z.enum(["captcha", "passkey"]),
  provider: z.string().optional(),
  required: z.boolean().default(true),
  satisfied: z.boolean().default(false),
  config: z.record(z.unknown()).optional(),
});

export const stepTextsSchema = z.object({
  title_key: textKey,
  description_key: textKey.optional(),
});

const transitionTarget = z.union([
  z.string().min(1),
  z.object({
    pivot: z.enum(["login", "register", "recovery", "profiling", "reauth", "link_account"]),
  }),
]);

export const stepDefinitionSchema = z.object({
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
  fields: z.record(flowFieldSchema).default({}),
  actions: z.record(flowActionSchema).default({}),
  gates: z.record(flowGateSchema).default({}),
  transitions: z.record(transitionTarget).optional(),
  config: z.record(z.unknown()).optional(),
});

export const flowDefinitionSchema = z.object({
  version: z.literal(1),
  kind: z.literal("flow-definition"),
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  purposes: z
    .array(z.enum(["login", "register", "recovery", "profiling", "reauth", "link_account"]))
    .nonempty(),
  template_name: z.string().default("default"),
  initial_steps: z.record(z.string()),
  audience: z
    .object({
      team_ids: z.array(z.string()).optional(),
      app_ids: z.array(z.string()).optional(),
      schema_ids: z.array(z.string()).optional(),
    })
    .optional(),
  steps: z.array(stepDefinitionSchema).nonempty(),
});

export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type StepDefinition = z.infer<typeof stepDefinitionSchema>;
export type FlowField = z.infer<typeof flowFieldSchema>;
export type FlowAction = z.infer<typeof flowActionSchema>;
export type FlowGate = z.infer<typeof flowGateSchema>;

export function collectTextKeys(flow: FlowDefinition): string[] {
  const keys = new Set<string>();
  for (const step of flow.steps) {
    if (step.texts?.title_key) keys.add(step.texts.title_key);
    if (step.texts?.description_key) keys.add(step.texts.description_key);
    for (const field of Object.values(step.fields ?? {})) {
      keys.add(field.text_key);
    }
    for (const action of Object.values(step.actions ?? {})) {
      keys.add(action.text_key);
    }
  }
  return [...keys].sort();
}
