import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Fumadocs' Open Graph card (fumadocs-ui/og) sets the title in 82px type and
// the description in 52px and clips neither, so a long title ran into the
// description and the site's name. Its box: 1200×630, 64px of padding and an
// 18px border at the foot, so 1072×484 for the title, the description (16px
// above it, 28px of padding and a 10px rule below) and the site's name (56px
// type beside a 56px icon) at the bottom.
const width = 1072;
const height = 484;
const descriptionChrome = 16 + 28 + 10;
const siteRow = 56 * 1.2;
// At least this much room between the description's rule and the site's name.
const gap = 24;

export const lineHeight = 1.2;
const descriptionSize = 52;
// The title shrinks until it fits in two lines, never below this.
const titleSizes = [82, 76, 70, 64, 58];

// next/og draws in Geist, the one font it bundles, so the card is measured in
// it as Satori measures a line it wraps: the sum of each character's advance,
// without kerning, which Satori applies only when it draws the line.
const geist = parseFont(
  await readFile(
    join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"),
  ),
);

/**
 * The card's type: the largest title size at which the title wraps at its
 * spaces into at most two lines, and as many lines of description as the room
 * left holds. A title that fits at no size gets the smallest, and wraps.
 */
export function cardLayout(title: string) {
  const smallest = titleSizes.at(-1) ?? 58;
  const titleSize = titleSizes.find((size) => lines(title, size) <= 2) ?? smallest;
  const wrapped = lines(title, titleSize);
  const titleLines = Number.isFinite(wrapped)
    ? wrapped
    : Math.ceil(geist.width(title, titleSize) / width);
  const room = height - siteRow - gap - descriptionChrome - titleLines * titleSize * lineHeight;
  return {
    titleSize,
    descriptionSize,
    descriptionLines: Math.max(1, Math.floor(room / (descriptionSize * lineHeight))),
  };
}

// Greedy wrapping at spaces, as Satori wraps. A word wider than the line
// cannot wrap at a space, and would run past the card's edge.
function lines(text: string, size: number) {
  const space = geist.width(" ", size);
  let count = 0;
  let line = Number.POSITIVE_INFINITY;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const advance = geist.width(word, size);
    if (advance > width) return Number.POSITIVE_INFINITY;
    if (line + space + advance <= width) {
      line += space + advance;
    } else {
      count++;
      line = advance;
    }
  }
  return count;
}

// The advance widths of a TrueType font: its `cmap` (format 4, the Basic
// Multilingual Plane) and `hmtx` tables.
function parseFont(file: Buffer) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + 16 * i;
    tables.set(file.toString("latin1", record, record + 4), view.getUint32(record + 8));
  }
  const table = (tag: string) => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`Geist has no ${tag} table`);
    return offset;
  };

  const unitsPerEm = view.getUint16(table("head") + 18);
  const metricCount = view.getUint16(table("hhea") + 34);
  const hmtx = table("hmtx");

  const cmap = table("cmap");
  let format4: number | undefined;
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const record = cmap + 4 + 8 * i;
    const subtable = cmap + view.getUint32(record + 4);
    if (view.getUint16(record) === 3 && view.getUint16(subtable) === 4) format4 = subtable;
  }
  if (format4 === undefined) throw new Error("Geist has no Unicode cmap");
  const segments = view.getUint16(format4 + 6) / 2;
  const ends = format4 + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const rangeOffsets = deltas + 2 * segments;

  const glyph = (code: number) => {
    for (let s = 0; s < segments; s++) {
      if (code > view.getUint16(ends + 2 * s)) continue;
      const start = view.getUint16(starts + 2 * s);
      if (code < start) return 0;
      const delta = view.getInt16(deltas + 2 * s);
      const rangeOffset = view.getUint16(rangeOffsets + 2 * s);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const id = view.getUint16(rangeOffsets + 2 * s + rangeOffset + 2 * (code - start));
      return id === 0 ? 0 : (id + delta) & 0xffff;
    }
    return 0;
  };
  const advance = (id: number) => view.getUint16(hmtx + 4 * Math.min(id, metricCount - 1));

  return {
    width(text: string, size: number) {
      let units = 0;
      for (const char of text) units += advance(glyph(char.codePointAt(0) ?? 0));
      return (units * size) / unitsPerEm;
    },
  };
}
