/** A screen's title: the 24/24 display face. */
export const PAGE_TITLE = "text-foreground font-serif text-2xl leading-6 tracking-tight";

/** The overline face: display, uppercase 12/16 with 0.72px tracking. Colour is the caller's. */
export const OVERLINE = "font-serif text-xs leading-4 tracking-[0.72px] uppercase";

/** A muted overline: section eyebrows and the label over a meta value. */
export const EYEBROW = `text-muted-foreground ${OVERLINE}`;

/** Head cell of a table inside a panel card: a muted overline, flush with the content edge. */
export const PANEL_HEAD_CELL =
  "h-auto px-0 py-3 font-serif text-xs font-normal tracking-[0.72px] text-muted-foreground uppercase";

/** Body cell of a table inside a panel card. */
export const PANEL_BODY_CELL = "px-0 py-3 text-sm";
