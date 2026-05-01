/**
 * Public design-token helper.
 *
 * Atoms reference design tokens through {@link cssVar}, which renders a CSS
 * `var(...)` reference together with a fallback default. The fallback keeps an
 * atom legible when used outside the `<zitadel-login>` host (Storybook,
 * direct-on-page experiments, etc.).
 *
 * The token catalogue is the single source of truth — see
 * `docs/design/branding/tokens.md` for the public contract.
 */
export type DesignToken = {
  readonly name: `--zl-${string}`;
  readonly default: string;
};

export function cssVar(token: DesignToken): string {
  return `var(${token.name}, ${token.default})`;
}

export function cssVarRef(token: DesignToken): string {
  return `var(${token.name})`;
}
