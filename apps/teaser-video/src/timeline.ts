// The teaser's beat grid: every cut, keystroke and hit is placed in beats, and
// a beat is a whole number of frames, so nothing drifts off the music. A new
// track changes BPM here and everything moves with it.

export const FPS = 60;
export const BPM = 120;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Frames in one beat: 30 at 60 fps and 120 BPM. */
export const FRAMES_PER_BEAT = (FPS * 60) / BPM;
export const BEATS_PER_BAR = 4;

/** Frames in `count` beats, rounded to the nearest frame. */
export const beats = (count: number) => Math.round(count * FRAMES_PER_BEAT);

type Section = { from: number; length: number };

/**
 * The sections, in beats. The terminal sets the login up over the first four
 * bars; the cold open's Enter lands on the downbeat of bar 7, where the
 * montage starts; the montage runs six bars, its last shot blurring into the
 * dark, and the outro starts on bar 13's downbeat, coming into focus out of it.
 */
export const SECTIONS = {
  cli: { from: 0, length: 16 },
  coldOpen: { from: 16, length: 8 },
  montage: { from: 24, length: 24 },
  outro: { from: 48, length: 10 },
} satisfies Record<string, Section>;

/**
 * The outro's moments, in beats from its start: the call to action holds for
 * a bar, the logo replaces it on the next downbeat and plays for two seconds
 * (four beats), and as its last letter lands everything scrolls up out of the
 * frame as the gradient rises, then fades to black over the last beat.
 */
export const OUTRO = {
  logo: 4,
  scroll: 8,
  scrollLength: 1.5,
  black: 9,
};

/**
 * How far into the montage the music drops, in beats: after its slow cuts,
 * over the pad and then the riser, so the drop lands as the cuts start to
 * speed up (montage/shots.tsx).
 */
export const MONTAGE_DROP = 8;

export const TOTAL_BEATS = SECTIONS.outro.from + SECTIONS.outro.length;
