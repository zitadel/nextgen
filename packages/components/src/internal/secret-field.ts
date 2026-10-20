/**
 * Which fields may have their value published outside the widget. Everything
 * else is treated as a secret, so a field nobody thought about (a PIN, a
 * security answer, a social security number typed into a plain text field)
 * stays private by default instead of leaking until someone adds it to a list.
 *
 * A value is disclosable only when the field definition says, explicitly, that
 * it is an identifier rather than a credential:
 *
 * - `type` is one of {@link DISCLOSABLE_FIELDS.types}, and
 * - `autocomplete` names one of {@link DISCLOSABLE_FIELDS.identifierTokens}, and
 * - `autocomplete` names no sensitive token: one of
 *   {@link DISCLOSABLE_FIELDS.secretTokens}, or one starting with a prefix in
 *   {@link DISCLOSABLE_FIELDS.secretPrefixes}. A sensitive token wins even next
 *   to an identifier one (`username cc-csc` is secret).
 *
 * The `type` alone never discloses a value: an `email` or `tel` field with no
 * identifier token, or a numeric PIN rendered as `tel`, stays secret. The
 * `autocomplete` text is normalised first: invisible format characters (a
 * zero-width space after `new-password`) are removed, any whitespace, a
 * non-breaking space included, separates tokens, and case is ignored.
 *
 * This is the one place the rule lives: the orchestrator applies it to the step
 * definition and the atoms apply it to their own `type` and `autocomplete`.
 */
export const DISCLOSABLE_FIELDS = {
  types: new Set(["text", "email", "tel"]),
  identifierTokens: new Set([
    "username",
    "email",
    "tel",
    "name",
    "given-name",
    "additional-name",
    "family-name",
    "nickname",
  ]),
  secretTokens: new Set([
    "current-password",
    "new-password",
    "one-time-code",
    "bday",
    "bday-day",
    "bday-month",
    "bday-year",
  ]),
  secretPrefixes: ["cc-", "transaction-"],
} as const;

/** The parts of a field definition the rule reads. */
export interface FieldDescription {
  readonly type?: string;
  readonly autocomplete?: string;
}

/** The lower-case tokens of an `autocomplete` value, with invisible characters removed. */
function autocompleteTokens(autocomplete: string | undefined): string[] {
  if (autocomplete === undefined) return [];
  return autocomplete
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .split(/[\s\p{Z}]+/u)
    .filter((token) => token !== "");
}

function isSensitiveToken(token: string): boolean {
  return (
    DISCLOSABLE_FIELDS.secretTokens.has(token) ||
    DISCLOSABLE_FIELDS.secretPrefixes.some((prefix) => token.startsWith(prefix))
  );
}

/** Whether the field's value may be published outside the widget. */
export function isDisclosable(field: FieldDescription | undefined): boolean {
  if (!field || field.type === undefined || !DISCLOSABLE_FIELDS.types.has(field.type)) {
    return false;
  }
  const tokens = autocompleteTokens(field.autocomplete);
  if (tokens.some(isSensitiveToken)) return false;
  return tokens.some((token) => DISCLOSABLE_FIELDS.identifierTokens.has(token));
}
