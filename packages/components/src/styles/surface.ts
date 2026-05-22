import { unsafeCSS, type CSSResult } from "lit";

/**
 * Wrap shared surface CSS (from `@zitadel-nextgen/shared-component-styles`)
 * for Lit `static styles`. Import `.css?inline` in atoms; `@tsdown/css` inlines
 * the strings when `components` is built.
 */
export function surfaceStyles(...cssChunks: string[]): CSSResult[] {
  return cssChunks.map((chunk) => unsafeCSS(chunk));
}
