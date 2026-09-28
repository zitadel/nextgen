import { css } from "lit";

import { t } from "./tokens.js";

/**
 * Shared shadow-root base styles. Each atom prepends this fragment to its own
 * `static styles` so font/colour inheritance, box-sizing, and resets stay
 * consistent without forcing a global stylesheet on the host page.
 */
export const baseHostStyles = css`
  :host {
    box-sizing: border-box;
    font-family: ${t.font.family.sans};
    color: ${t.theme.foreground};
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
`;
