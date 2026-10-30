import { random } from "remotion";

import { beats, seconds } from "../timeline";

// Keystrokes, in frames from a shot's start, shared by the picture
// (identifier.tsx) and the click track's key sounds (click-track.tsx): the
// cold open's address, and the identifiers the montage types after it.

export const TYPED = "ada@zitadel.com";

/** The caret blinks in the empty field for two beats, then the typing starts. */
export const TYPING_START = beats(2);
/** The last key, a little under a beat before Enter. */
export const TYPING_END = beats(7) - seconds(0.1);
/** Enter, on the downbeat that starts the montage. */
export const ENTER = beats(8);

/**
 * The frame each character of `text` is typed on, the first at `start` and the
 * last at `end`. A person types unevenly: each gap varies a little, by a fixed
 * seed so every render types alike, and the hand slows before a `@`, a `.`, a
 * `-` or a space, where it reaches for another key.
 */
export function keystrokes(text: string, start: number, end: number, seed = "key"): number[] {
  const gaps = [...text].slice(1).map((char, index) => {
    const reach = "@.- ".includes(char) ? 0.9 : 0;
    return 1 + random(`${seed}-${index}`) * 0.8 + reach;
  });
  const span = gaps.reduce((sum, gap) => sum + gap, 0);
  let at = 0;
  return [
    start,
    ...gaps.map((gap) => {
      at += gap;
      return Math.round(start + (at / span) * (end - start));
    }),
  ];
}

export const KEYSTROKES = keystrokes(TYPED, TYPING_START, TYPING_END);
