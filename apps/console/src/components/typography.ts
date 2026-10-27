/** A screen's title: the 24/24 display face. */
export const PAGE_TITLE = "text-foreground font-serif text-2xl leading-6 tracking-tight";

/** The row every screen's title sits in (`docs/styling.md`, "Page wrapper"). */
export const PAGE_TITLE_ROW = "flex min-h-9 items-center justify-between gap-3";

/**
 * A card's or section's primary title: the 16/20 display face (Figma text
 * style `zitadel/heading-md` in the detail panel components, not the larger
 * `heading-md` token in the exported `4. Custom` collection). Every
 * `DetailSection` title and every top-level section on a detail or settings
 * screen uses it.
 */
export const SECTION_HEADING = "text-foreground font-serif text-base leading-5";

/**
 * A subordinate heading inside a card's body, under its section title: the
 * 14/20 display face (Figma text style `zitadel/heading-sm`).
 */
export const SUBSECTION_HEADING = "text-foreground font-serif text-sm leading-5";

/** The overline face: display, uppercase 12/16 with 0.72px tracking. Colour is the caller's. */
export const OVERLINE = "font-serif text-xs leading-4 tracking-[0.72px] uppercase";

/** A muted overline: section eyebrows and the label over a meta value. */
export const EYEBROW = `text-muted-foreground ${OVERLINE}`;

/** Head cell of a table inside a panel card: a muted overline, flush with the content edge. */
export const PANEL_HEAD_CELL =
  "h-auto px-0 py-3 font-serif text-xs font-normal tracking-[0.72px] text-muted-foreground uppercase";

/** Body cell of a table inside a panel card. */
export const PANEL_BODY_CELL = "px-0 py-3 text-sm";

/** Form field labels: Arimo, 14px/20px, regular weight. */
export const FIELD_LABEL_TYPOGRAPHY = "font-sans text-sm leading-5 font-normal";
