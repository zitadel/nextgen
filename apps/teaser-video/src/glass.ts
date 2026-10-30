import type { CSSProperties } from "react";

// The website's frosted glass (apps/website/app/globals.css: --color-glass,
// --glass-shadow, and the header's backdrop-blur-xl backdrop-saturate-150): a
// dark, half-clear surface that blurs and lifts what lies behind it, a
// hairline edge, and a light along its top. It only reads over something to
// blur, so the scenes that use it put a glow or a picture behind.

const SHADOW =
  "inset 0 1px 0 rgb(255 255 255 / 0.06), 0 1px 2px rgb(0 0 0 / 0.25), 0 4px 12px -8px rgb(0 0 0 / 0.5)";
const BLUR = "blur(24px) saturate(1.5)";

/** A glass surface, for a panel of the video's own. */
export const GLASS: CSSProperties = {
  background: "rgb(20 20 23 / 0.55)",
  border: "1px solid rgb(255 255 255 / 0.1)",
  backdropFilter: BLUR,
  boxShadow: SHADOW,
};

/**
 * The same glass for the login's card, the way an app would set it: through
 * the --zl-* properties and the card's `card` part. Put the rule on the page
 * and the class on what holds the card.
 */
export const GLASS_CARD = "glass-card";
export const GLASS_CARD_RULE = `
.${GLASS_CARD} {
  --zl-card: rgb(20 20 23 / 0.55);
  --zl-border: rgb(255 255 255 / 0.1);
}
.${GLASS_CARD} zl-card::part(card) {
  backdrop-filter: ${BLUR};
  box-shadow: ${SHADOW};
}`;
