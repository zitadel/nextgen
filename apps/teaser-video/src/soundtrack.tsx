import { Audio, Sequence, staticFile } from "remotion";

import { BPM, FPS, MONTAGE_DROP, SECTIONS, beats } from "./timeline";

// The music: "Mörkret" by Ooyy, licensed for the video and kept out of the
// repository (public/music/ is git-ignored), so a render needs the file in
// place. It runs at 120 BPM, the grid's own tempo, and the edit has one join:
//
// - the song's calm opening pad from the video's start, under the terminal,
//   the cold open and the first identifiers;
// - blending into the riser, which climbs into the drop as the montage speeds
//   up, after which the song simply plays on to the end, under the blackout,
//   the call to action and the logo, fading out with the scroll.

/**
 * The track and its beat grid, measured from the audio: a beat every half
 * second from `firstBeat`, the opening pad from beat 0, steady until the bass
 * comes in on beat 32, and the drop on beat 96 (0:48.04), a downbeat, at the
 * end of a riser.
 */
const TRACK = {
  // The file name is stored decomposed (o + combining diaeresis), as macOS
  // wrote it; normalising here keeps an editor's recomposition from breaking it.
  src: staticFile("music/mörket.mp3".normalize("NFD")),
  firstBeat: 0.039,
  pad: 0,
  drop: 96,
};

/** Where the track's beat `beat` starts, in frames of the video. */
const sourceFrame = (beat: number) => Math.round((TRACK.firstBeat + (beat * 60) / BPM) * FPS);

/**
 * The join: the riser starts this many beats before the drop, fading in over
 * the first two while the pad fades out over the first three, so the two
 * blend rather than switch.
 */
const LEAD_IN = 6;
const FADE_IN = 2;
const BLEND = 3;

/** The music fades out over the last beats, ending with the video. */
const FADE_OUT = 2;

const { cli, montage, outro } = SECTIONS;
const drop = montage.from + MONTAGE_DROP;
const join = drop - LEAD_IN;
const end = outro.from + outro.length;

// Equal-power curves, so the blend keeps its loudness.
const rise = (share: number) => Math.sin((Math.min(1, Math.max(0, share)) * Math.PI) / 2);
const fall = (share: number) => Math.cos((Math.min(1, Math.max(0, share)) * Math.PI) / 2);

export function Soundtrack() {
  const padFrames = beats(join + BLEND) - beats(cli.from);
  const blend = beats(join) - beats(cli.from);
  const songFrames = beats(end) - beats(join);
  return (
    <>
      <Sequence name="Opening pad" from={beats(cli.from)} durationInFrames={padFrames}>
        <Audio
          src={TRACK.src}
          trimBefore={sourceFrame(TRACK.pad)}
          volume={(frame) => fall((frame - blend) / beats(BLEND))}
        />
      </Sequence>
      <Sequence name="Riser, drop and on" from={beats(join)} durationInFrames={songFrames}>
        <Audio
          src={TRACK.src}
          trimBefore={sourceFrame(TRACK.drop - LEAD_IN)}
          volume={(frame) =>
            rise(frame / beats(FADE_IN)) *
            fall((frame - (songFrames - beats(FADE_OUT))) / beats(FADE_OUT))
          }
        />
      </Sequence>
    </>
  );
}
