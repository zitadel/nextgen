import { unsafeCSS, type CSSResult } from "lit";

/**
 * Wrap an atom's co-located `.css` file for Lit `static styles`. Import it as
 * `./zl-<atom>.css?inline`; `@tsdown/css` inlines the string when `components`
 * is built, and Vite does the same in dev and vitest.
 */
export function surfaceStyles(...cssChunks: string[]): CSSResult[] {
  return cssChunks.map((chunk) => unsafeCSS(chunk));
}
