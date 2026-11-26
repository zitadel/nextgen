/**
 * Localises a step for the login templates: the step's texts and notice for
 * the identifier it collects, and the `error.*` keys the server returns. None
 * of it needs LiquidJS, so `<zitadel-login>` imports it eagerly and loads the
 * engine (`liquid.ts`) only when it renders.
 */
import type { CreateFlow201Step, CreateFlow201StepFieldsItem } from "@zitadel/api/generated/model";
import type { FlowError } from "./template-context.js";
import type { Locale } from "./locales/en.js";
import { CUSTOM_IDENTIFIER_SUFFIX } from "./locales/index.js";

/**
 * Maps catalog `error.*` keys with no `_<rule>` suffix (so
 * {@link localiseFlowErrorKeys} can't derive the field from the key itself)
 * to their field name — the credential errors with bespoke catalog copy
 * (`error.email_exists`, `error.invalid_credentials`, …). Rule-suffixed keys
 * (`error.<field>_<rule>`) derive their field from the key. Consumed only by
 * {@link localiseFlowErrorKeys}, which stamps the resolved `field` onto the
 * error; the template filters (`fieldError` / `formLevelError`) then route by
 * that `field`, and an error whose field the step omits is downgraded to a
 * fieldless banner message.
 */
const fieldErrorKeys: Record<string, string> = {
  "error.email_required": "email",
  "error.email_invalid": "email",
  "error.email_exists": "email",
  "error.password_required": "password",
  "error.password_incorrect": "password",
  "error.invalid_credentials": "password",
};

export const SSO_DESCRIPTION_SUFFIX = ".description.sso";

type StepTexts = NonNullable<CreateFlow201Step["texts"]>;

/**
 * A step's texts as the template renders them. A step that collects an
 * identifier other than an email address (a schema whose `x-identifier` is
 * `employee_number`, say) describes itself with the
 * `<step>.description.custom_identifier` variant where the locale has one,
 * since the plain sentence may name the email: "Enter your email to continue"
 * above an "Employee number" field. The variant replaces the `.sso` one too:
 * a provider sentence may name the email as well, and leaving the providers
 * out of the subtitle is the smaller loss, as they show on the step anyway.
 */
export function stepTexts(
  texts: StepTexts,
  fields: readonly CreateFlow201StepFieldsItem[],
  locale: Locale,
): StepTexts {
  const key = texts.description_key;
  if (!key || !collectsCustomIdentifier(fields)) return texts;
  const plain = key.endsWith(SSO_DESCRIPTION_SUFFIX) ? key.slice(0, -".sso".length) : key;
  const variant = `${plain}${CUSTOM_IDENTIFIER_SUFFIX}`;
  return plain.endsWith(".description") && locale[variant] !== undefined
    ? { ...texts, description_key: variant }
    : texts;
}

/**
 * The key a step's `notice` renders with. Like {@link stepTexts}, a step that
 * collects an identifier other than an email address asks for the
 * `notice.<reason>.custom_identifier` variant where the locale has one: the
 * register step a sign-in moved to sign-up says the email had no account, and
 * points at an email field it does not show.
 *
 * A step that does not collect the identifier, such as the password step a
 * sign-up moves to sign-in, cannot tell: `step.identifier` carries no type.
 * Its notices are worded for any identifier instead.
 */
export function stepNotice(
  notice: string,
  fields: readonly CreateFlow201StepFieldsItem[],
  locale: Locale,
): string {
  const variant = `${notice}${CUSTOM_IDENTIFIER_SUFFIX}`;
  return collectsCustomIdentifier(fields) && locale[variant] !== undefined ? variant : notice;
}

/**
 * Whether the step collects the user's identifier and it is not an email
 * address. The server marks the identifier field `autocomplete="username"`
 * whatever its type (`field.yaml`), so that token finds it.
 */
function collectsCustomIdentifier(fields: readonly CreateFlow201StepFieldsItem[]): boolean {
  const identifier = fields.find((field) =>
    (field.autocomplete ?? "").toLowerCase().split(/\s+/).includes("username"),
  );
  return identifier !== undefined && identifier.type !== "email";
}

export type FlowErrorKeyContext = {
  locale: Locale;
  /** Step name, for `<step>.field.<name>` label lookups. */
  stepName: string;
  /**
   * Names of the fields the step renders. When provided, an inline-routed
   * key (see `fieldErrorKeys`) whose field is absent is downgraded to a
   * pre-localised banner message — its inline outlet doesn't exist, and
   * `formLevelError` would otherwise suppress the banner too, silently
   * hiding the error. Omit to skip the check (pure lookups).
   */
  fields?: readonly string[];
  /**
   * The validation each of the step's fields carries, by name. A length key
   * whose field carries its bound names it ("at least 12 characters") instead
   * of the generic "too short".
   */
  validations?: Readonly<Record<string, FieldValidation | undefined>>;
};

/** The validation a step field carries, as the API generates it. */
type FieldValidation = NonNullable<CreateFlow201StepFieldsItem["validation"]>;

/**
 * Rule-suffix fallbacks for the server's field-validation keys
 * (`error.<field>_<rule>` — see `FlowFieldValidationError.TextKey` in
 * `internal/domain/flow_field_resolver.go`). Field names come from the
 * tenant's user schema, so no catalog can enumerate the specific keys;
 * a miss resolves to the rule's generic entry, interpolated with the
 * field's label (`{0}`). The server spells the format rule `_invalid`
 * (the catalog's existing convention, e.g. `error.email_invalid`), so
 * that suffix takes the format wording; `_unknown_field` (a submitted
 * name that is not a step field) takes the catch-all.
 */
const FLOW_ERROR_RULE_FALLBACKS: ReadonlyArray<{
  suffix: string;
  generic: string;
  /**
   * For a length rule: the catalog entry that names the field's bound as
   * `{1}`, and where the bound sits in the field's validation.
   */
  withBound?: { key: string; bound: (validation: FieldValidation) => number | undefined };
}> = [
  { suffix: "_required", generic: "error.field_required" },
  {
    suffix: "_min_length",
    generic: "error.field_min_length",
    withBound: { key: "error.field_min_length_value", bound: (v) => v.min_length },
  },
  {
    suffix: "_max_length",
    generic: "error.field_max_length",
    withBound: { key: "error.field_max_length_value", bound: (v) => v.max_length },
  },
  { suffix: "_format", generic: "error.field_format" },
  { suffix: "_invalid", generic: "error.field_format" },
  { suffix: "_unknown_field", generic: "error.field_invalid" },
];

const FLOW_ERROR_CATCH_ALL_KEY = "error.field_invalid";

/**
 * Localises a `step.error` payload of `error.*` catalog keys —
 * field-validation violations and general engine failures (e.g.
 * `error.invalid_credentials`, `error.passkey_invalid`) alike.
 * Returns `null` unless EVERY `"; "`-joined segment is an `error.*` key
 * — the caller keeps any other payload verbatim.
 *
 * Keys the locale knows pass through as `text_key` entries: the template
 * localises them via `| t`, and `fieldErrorKeys` routes the known ones
 * inline to their field. Unknown keys with a recognised rule suffix are
 * pre-localised here from their generic {@link FLOW_ERROR_RULE_FALLBACKS}
 * entry; unknown keys without one pass through as `text_key` (matching
 * `| t`'s behaviour for non-validation keys such as
 * `error.sign_in_server`, which localises via `.title`/`.body`).
 */
export function localiseFlowErrorKeys(raw: string, ctx: FlowErrorKeyContext): FlowError[] | null {
  const segments = raw.split("; ");
  if (!segments.every((segment) => segment.startsWith("error."))) return null;
  return segments.map((key) => localiseFlowErrorKey(key, ctx));
}

function localiseFlowErrorKey(key: string, ctx: FlowErrorKeyContext): FlowError {
  // An inline-routed key can only render on its field; when the step
  // doesn't carry that field, fall through to the pre-localised message
  // paths so the error surfaces as a banner instead of vanishing.
  const inlineField = renderedField(fieldErrorKeys[key], ctx.fields);
  const orphanedInline =
    inlineField !== undefined && ctx.fields !== undefined && !ctx.fields.includes(inlineField);
  if (!orphanedInline && ctx.locale[key] !== undefined) {
    // Catalog-known key. A field-mapped one (email/password) routes inline to
    // its field; an unmapped one (e.g. `error.sign_in_server`) stays
    // form-level, localising through its `.title`/`.body` sub-keys in the
    // alert filters.
    return inlineField !== undefined ? { field: inlineField, text_key: key } : { text_key: key };
  }
  for (const { suffix, generic, withBound } of FLOW_ERROR_RULE_FALLBACKS) {
    if (!key.endsWith(suffix)) continue;
    const field = key.slice("error.".length, key.length - suffix.length);
    if (field === "") break;
    const label = fieldLabel(ctx, field);
    // A length rule names the field's bound when the field carries a
    // positive one and the locale has the wording; otherwise the generic
    // sentence.
    const validation = ctx.validations?.[field];
    const bound = withBound && validation ? withBound.bound(validation) : undefined;
    const boundTemplate = withBound ? ctx.locale[withBound.key] : undefined;
    const message = capitaliseFirst(
      typeof bound === "number" && bound > 0 && boundTemplate !== undefined
        ? interpolate(boundTemplate, [label, String(bound)])
        : interpolate(
            ctx.locale[generic] ?? ctx.locale[FLOW_ERROR_CATCH_ALL_KEY] ?? "Please check {0}.",
            [label],
          ),
    );
    // Route inline when the step renders this field (the inline outlet exists);
    // otherwise keep it a banner message so it can never silently vanish. A
    // fields-less pure lookup can't confirm the outlet, so it stays a banner.
    const rendered = ctx.fields !== undefined && ctx.fields.includes(field);
    return rendered ? { field, message } : { message };
  }
  // Orphaned inline key without a recognised rule suffix (e.g.
  // `error.email_exists`): surface its catalog copy as a banner message.
  if (orphanedInline && ctx.locale[key] !== undefined) {
    return { message: ctx.locale[key] };
  }
  return { text_key: key };
}

/**
 * The step field a {@link fieldErrorKeys} entry lands on. A sign-in method's
 * field is keyed by its schema pointer (`x-auth-methods#password`), so
 * `password` resolves to that when the step has no plain `password` field.
 */
function renderedField(
  mapped: string | undefined,
  fields: readonly string[] | undefined,
): string | undefined {
  if (mapped === undefined || fields === undefined || fields.includes(mapped)) return mapped;
  const pointer = `x-auth-methods#${mapped}`;
  return fields.includes(pointer) ? pointer : mapped;
}

/** `<step>.field.<name>` from the locale, else a humanised field name. */
function fieldLabel(ctx: FlowErrorKeyContext, field: string): string {
  const fromStep = ctx.locale[`${ctx.stepName}.field.${field}`];
  return fromStep ?? humaniseFieldName(field);
}

/**
 * `x-auth-methods#password` → "password", `givenName` → "given name",
 * `date_of_birth` → "date of birth".
 */
export function humaniseFieldName(field: string): string {
  const afterHash = field.includes("#") ? (field.split("#").pop() as string) : field;
  return afterHash
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Messages may open with a lowercase field label; sentence-case them. */
export function capitaliseFirst(text: string): string {
  return text.length > 0 ? text[0]?.toUpperCase() + text.slice(1) : text;
}

/**
 * Positional `{n}` substitution shared by the `| t` filter and the
 * pre-localising fallback in {@link localiseFlowErrorKeys}, so both
 * produce byte-identical output for the same template and args.
 */
export function interpolate(template: string, args: readonly string[]): string {
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const i = Number(index);
    return args[i] ?? match;
  });
}
