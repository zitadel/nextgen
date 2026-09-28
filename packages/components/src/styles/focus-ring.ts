import { css } from "lit";

import { t } from "./tokens.js";

/**
 * Visible focus indicator shared across interactive atoms. Applied via
 * `&:focus-visible { ${focusVisibleStyles} }`. The colour is the `ring` role —
 * the design system's one focus colour, mode-aware so the ring stays visible on
 * a light surface as well as a dark one.
 */
export const focusVisibleStyles = css`
  outline: ${t.focus.width} solid ${t.theme.ring};
  outline-offset: ${t.focus.offset};
`;
