import { css } from "lit";

import { tokens } from "../tokens/catalogue.js";
import { cssTokenVar as v } from "./css-helpers.js";

/**
 * Visible focus indicator shared across interactive atoms.
 * Atoms apply via `&:focus-visible { ${focusVisibleStyles} }`.
 */
export const focusVisibleStyles = css`
  outline: ${v(tokens.border.widthStrong)} solid ${v(tokens.color.focusRing)};
  outline-offset: 2px;
`;
