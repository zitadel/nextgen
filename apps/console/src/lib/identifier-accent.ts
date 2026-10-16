/**
 * Accents for the users table's identifier relation: one per identifier
 * property, so an email-identified row and a username-identified one light in
 * different colours.
 *
 * Hues, in the order properties are assigned them: blue, violet, cyan, pink.
 * Green (`active`), amber (warning) and red (destructive) already mean
 * something on that screen, so none sits near them.
 */
export const ACCENT_HUES = [255, 300, 200, 345] as const;

/**
 * How far each accent is mixed toward the theme's `foreground`.
 *
 * `chart-1` alone is tuned for chart fills, not text: as a 10–12px label it
 * measures 2.3–3.6:1 on the light canvas. Mixing toward the foreground darkens
 * it on light and lightens it on dark from the one expression, and 35% is the
 * least that clears WCAG AA (4.5:1) for the chip, the header label and the
 * hovered cell in both themes — `identifier-accent.spec.ts` holds it there.
 */
export const FOREGROUND_MIX = 35;

/**
 * The accent for one hue, as a CSS colour.
 *
 * Lightness and chroma come from the theme's `chart-1`, so every accent reads
 * at the same weight and a property keeps its hue in both themes; only the
 * hue is set here.
 */
export function accentColor(hue: number): string {
  return `color-mix(in oklch, oklch(from var(--color-chart-1) l c ${hue}), var(--color-foreground) ${FOREGROUND_MIX}%)`;
}

/**
 * One accent per identifier property, keyed by property. Assigned in name
 * order, so `email` keeps its colour however the list pages in.
 */
export function identifierAccents(properties: string[]): Map<string, string> {
  return new Map(
    [...properties]
      .sort()
      .map((property, index) => [
        property,
        accentColor(ACCENT_HUES[index % ACCENT_HUES.length] as number),
      ]),
  );
}
