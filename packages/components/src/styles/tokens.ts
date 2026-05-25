import { cssVars as raw } from "@zitadel-nextgen/design-tokens";
import { unsafeCSS, type CSSResult } from "lit";

/**
 * Lit-friendly token bridge.
 *
 * `@zitadel-nextgen/design-tokens` exports two parallel trees:
 *   - `tokens.color.text.primaryWhite === "#f4f4f6"` (resolved values)
 *   - `cssVars.color.text.primaryWhite === "var(--zl-color-text-primary-white)"`
 *
 * Atom CSS authored with Lit's `css` tagged template needs `CSSResult`
 * fragments, not raw strings. This module wraps the cssVars tree in
 * `unsafeCSS` once so every atom can write:
 *
 *     css`background: ${t.color.surface.defaultBlack};`
 *
 * The cssVars tree itself never changes shape outside of a design-tokens
 * rebuild, so the `unsafeCSS` calls are constant and safe.
 */
type CssNode = CSSResult | { readonly [k: string]: CssNode };
type CssTree = {
  [K in keyof typeof raw]: WrapTree<(typeof raw)[K]>;
};
type WrapTree<T> = T extends string
  ? CSSResult
  : T extends Record<string, unknown>
    ? { [K in keyof T]: WrapTree<T[K]> }
    : never;

function wrap(node: unknown): CssNode {
  if (typeof node === "string") return unsafeCSS(node);
  const out: Record<string, CssNode> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = wrap(value);
  }
  return out;
}

export const t = wrap(raw) as unknown as CssTree;
