/**
 * Normalises a flow field name into its automation-hook token.
 *
 * Auth-method credential fields arrive from the flow engine as
 * `x-auth-methods#<method>` (e.g. `x-auth-methods#password`), but the
 * documented `data-testid` hooks are method-named
 * (`zitadel-field-password`, `zitadel-input-password` — see
 * packages/components/README.md and apps/cli/SKILLS.md). This helper
 * feeds both hook construction sites: the bundled template's `testid`
 * Liquid filter and `<zl-field>`'s native-input testid.
 *
 * Only the hook is normalised — the field's `name` attribute stays the
 * raw wire/form key. The after-`#` token is used verbatim (no case or
 * spacing changes). Testids are hooks, not identity: a step containing
 * both `x-auth-methods#password` and a schema field literally named
 * `password` would collide, which is theoretical and unhandled by
 * design.
 */
export function hookName(field: string): string {
  const hash = field.lastIndexOf("#");
  if (hash === -1 || hash === field.length - 1) {
    return field;
  }
  return field.slice(hash + 1);
}
