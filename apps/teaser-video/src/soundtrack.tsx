import { Audio, interpolate, Sequence, staticFile } from "remotion";

import { BPM, FPS, MONTAGE_DROP, OUTRO, SECTIONS, beats } from "./timeline";

// The music: "Mörkret" by Ooyy, licensed for the video and kept out of the
// repository (public/music/ is git-ignored), so a render needs the file in
// place. It runs at 120 BPM, the grid's own tempo, and the edit follows the
// song's own build, with no silence anywhere:
//
// - the song's calm opening pad, uninterrupted, under the terminal, the cold
//   open and the montage's first slow cuts (it runs 15 seconds before the
//   bass comes in);
// - the riser's last bar, where it climbs, under the rest of the slow cuts,
//   into the drop as the cuts speed up, and on into the groove;
// - the riser's last bar again under the blackout and the call to action;
// - the drop once more as the logo replaces the call to action, so the beat
//   comes back with the logo and carries the outro, fading out under the
//   scroll.

/**
 * The track and its beat grid, measured from the audio: a beat every half
 * second from `firstBeat`, the opening pad from beat 0, and the drop on beat
 * 96 (0:48.04), a downbeat, after a riser of two bars; the edit uses only
 * the second, where it climbs (the first is as quiet as the pad).
 */
const TRACK = {
  // The file name is stored decomposed (o + combining diaeresis), as macOS
  // wrote it; normalising here keeps an editor's recomposition from breaking it.
  src: staticFile("music/mörket.mp3".normalize("NFD")),
  firstBeat: 0.039,
  pad: 0,
  drop: 96,
  riser: 4,
};

/** Where the track's beat `beat` starts, in frames of the video. */
const sourceFrame = (beat: number) => Math.round((TRACK.firstBeat + (beat * 60) / BPM) * FPS);

/** One piece of the edit: where it plays in the video and which track beat it starts on, both in beats. */
type Piece = { name: string; at: number; length: number; from: number };

const { cli, montage, blackout, outro } = SECTIONS;
const drop = montage.from + MONTAGE_DROP;
const riser = drop - TRACK.riser;
const logo = outro.from + OUTRO.logo;
const end = outro.from + outro.length;

const PIECES: Piece[] = [
  { name: "Opening pad", at: cli.from, length: riser - cli.from, from: TRACK.pad },
  {
    name: "Riser into the drop",
    at: riser,
    length: blackout.from - riser,
    from: TRACK.drop - TRACK.riser,
  },
  {
    name: "Riser's last bar",
    at: blackout.from,
    length: logo - blackout.from,
    from: TRACK.drop - (logo - blackout.from),
  },
  { name: "Drop under the logo", at: logo, length: end - logo, from: TRACK.drop },
];

/**
 * Each piece plays this many frames past its end, fading out under the next
 * one's start, so a cut never dips; the next one fades in over a single frame,
 * which keeps its first beat's attack.
 */
const OVERLAP = 3;

/** The last piece fades out over the outro's last beats, ending with the video. */
const FADE_OUT = 2;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function Soundtrack() {
  return (
    <>
      {PIECES.map(({ name, at, length, from }, index) => {
        const last = index === PIECES.length - 1;
        const frames = beats(at + length) - beats(at);
        const fadeIn = index === 0 ? 0 : 1;
        return (
          <Sequence
            key={name}
            name={name}
            from={beats(at)}
            durationInFrames={frames + (last ? 0 : OVERLAP)}
          >
            <Audio
              src={TRACK.src}
              trimBefore={sourceFrame(from)}
              volume={(frame) =>
                (fadeIn ? interpolate(frame, [0, fadeIn], [0, 1], clamp) : 1) *
                (last
                  ? interpolate(frame, [frames - beats(FADE_OUT), frames], [1, 0], clamp)
                  : interpolate(frame, [frames, frames + OVERLAP], [1, 0], clamp))
              }
            />
          </Sequence>
        );
      })}
    </>
  );
}
