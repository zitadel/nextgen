import { expect } from "storybook/test";

/**
 * Cross-renderer parity gate. Lit atoms and their paired React components share
 * one `.zr-*` surface stylesheet, so for identical inputs they must compute
 * identical styles. A `Parity` story mounts both renderers side by side and
 * calls {@link assertParity}, which diffs `getComputedStyle` for each shared
 * selector — the Lit node lives in its shadow root, the React node in its
 * container, but the painted result must match.
 *
 * This is the automated form of the side-by-side eyeball: it deterministically
 * catches the box-model / colour / type drift that a screenshot only hints at
 * (e.g. a missing `box-sizing: border-box` rendering 56px rows instead of 40px,
 * or `-webkit-font-smoothing` diverging because React has no `baseHostStyles`).
 */
export const PARITY_PROPS = [
  "display",
  "boxSizing",
  "height",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderTopColor",
  "borderBottomWidth",
  "borderRadius",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "color",
  "backgroundColor",
  "webkitFontSmoothing",
] as const;

function styleOf(root: ParentNode, selector: string, props: readonly string[]): Record<string, string> {
  const el = root.querySelector(selector);
  if (!el) {
    const where = root instanceof ShadowRoot ? "Lit shadow root" : "React tree";
    throw new Error(`parity: "${selector}" not found in ${where}`);
  }
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const prop of props) out[prop] = cs[prop as keyof CSSStyleDeclaration] as string;
  return out;
}

/**
 * Assert the Lit atom (queried in `litShadow`) and the React pair (queried in
 * `reactRoot`) compute identical styles for every selector. Selectors must hit
 * the same element type/classes in both renderers (e.g. `.zr-select__trigger`,
 * not the `<zl-icon>`-host-vs-`<span>` wrappers, which differ structurally by
 * design).
 */
export function assertParity(
  litShadow: ShadowRoot,
  reactRoot: ParentNode,
  selectors: string[],
  props: readonly string[] = PARITY_PROPS,
): void {
  for (const selector of selectors) {
    const lit = styleOf(litShadow, selector, props);
    const react = styleOf(reactRoot, selector, props);
    expect(react, `computed-style drift at "${selector}" (React vs Lit)`).toEqual(lit);
  }
}
