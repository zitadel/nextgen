/**
 * Which fields may have their value published outside the widget. Everything
 * else is treated as a secret, so a field nobody thought about (a PIN, a
 * security answer, a social security number typed into a plain text field)
 * stays private by default instead of leaking until someone adds it to a list.
 *
 * A value is disclosable only when the field definition says it is an
 * identifier rather than a credential:
 *
 * - `type` is one of {@link DISCLOSABLE_FIELDS.types}, or
 * - `type` is `text` and `autocomplete` names one of
 *   {@link DISCLOSABLE_FIELDS.textAutocomplete},
 *
 * and `autocomplete` names none of {@link DISCLOSABLE_FIELDS.secretAutocomplete},
 * which always wins. Tokens are compared case-insensitively. This is the one
 * place the rule lives: the orchestrator applies it to the step definition and
 * the atoms apply it to their own `type` and `autocomplete`.
 */
export const DISCLOSABLE_FIELDS = {
  types: new Set(["email", "tel"]),
  textAutocomplete: new Set([
    "username",
    "email",
    "tel",
    "name",
    "given-name",
    "additional-name",
    "family-name",
    "nickname",
  ]),
  secretAutocomplete: new Set(["current-password", "new-password", "one-time-code"]),
} as const;

/** The parts of a field definition the rule reads. */
export interface FieldDescription {
  readonly type?: string;
  readonly autocomplete?: string;
}

/** Whether the field's value may be published outside the widget. */
export function isDisclosable(field: FieldDescription | undefined): boolean {
  if (!field) return false;
  const tokens = field.autocomplete?.toLowerCase().split(/\s+/) ?? [];
  if (tokens.some((token) => DISCLOSABLE_FIELDS.secretAutocomplete.has(token))) return false;
  if (field.type !== undefined && DISCLOSABLE_FIELDS.types.has(field.type)) return true;
  return (
    field.type === "text" && tokens.some((token) => DISCLOSABLE_FIELDS.textAutocomplete.has(token))
  );
}
