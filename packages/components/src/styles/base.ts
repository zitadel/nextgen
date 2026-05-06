import { css } from "lit";

import { tokens } from "../tokens/catalogue.js";
import { cssTokenVar as v } from "./css-helpers.js";

/**
 * Shared shadow-root base styles. Each atom prepends this fragment to its own
 * `static styles` so font/colour inheritance, box-sizing, and resets stay
 * consistent without forcing a global stylesheet on the host page.
 */
export const baseHostStyles = css`
  :host {
    box-sizing: border-box;
    font-family: ${v(tokens.font.family)};
    color: ${v(tokens.color.text)};
    line-height: ${v(tokens.font.lineHeightNormal)};
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
`;
