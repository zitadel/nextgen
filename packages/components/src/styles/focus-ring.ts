import { css } from "lit";

import { t } from "./tokens.js";

/**
 * Visible focus indicator shared across interactive atoms. Mirrors the
 * Figma button "Focused" state — a 2px white outline offset by 2px from
 * the element edge. Atoms apply via `&:focus-visible { ${focusVisibleStyles} }`.
 */
export const focusVisibleStyles = css`
  outline: ${t.focus.width} solid ${t.focus.color};
  outline-offset: ${t.focus.offset};
`;
