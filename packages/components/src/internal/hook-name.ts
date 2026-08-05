/**
 * Reserved auth-method credential prefix of flow field names. Mirrors
 * `AUTH_METHOD_PREFIX` in `@zitadel/config` (`src/validate.ts`), which
 * owns the wire dialect; components has no dependency on that package,
 * so the literal is repeated here.
 */
const AUTH_METHOD_PREFIX = "x-auth-methods#";

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
 * Only the reserved credential prefix is stripped — user-schema
 * property names are tenant-authored arbitrary strings, so a `#`
 * anywhere else is part of the name and stays in the hook. The
 * after-prefix token is used verbatim (no case or spacing changes),
 * and the field's `name` attribute always keeps the raw wire/form key.
 */
export function hookName(field: string): string {
  if (field.startsWith(AUTH_METHOD_PREFIX) && field.length > AUTH_METHOD_PREFIX.length) {
    return field.slice(AUTH_METHOD_PREFIX.length);
  }
  return field;
}
