/**
 * Re-export of `@zitadel/design-tokens` under the same subpath the
 * components package has always exposed. Atoms consume tokens through
 * `../styles/tokens.js` (which wraps the cssVars tree in Lit's `unsafeCSS`);
 * external consumers that want the raw values or the CSS variable strings
 * can still `import { tokens, cssVars } from "@zitadel/components/tokens"`.
 */
export { tokens, cssVars, type Tokens, type CssVars } from "@zitadel/design-tokens";
