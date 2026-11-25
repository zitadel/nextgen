import { Audio, Sequence, staticFile } from "remotion";

import { BPM, FPS, MONTAGE_DROP, SECTIONS, beats } from "./timeline";

// The music, when there is a track to cut to; the video ships without one.
// The edit has one join, so it suits a track that opens calm and drops later:
//
// - the track's calm opening from the video's start, under the terminal, the
//   cold open and the first identifiers;
// - blending into the bars before its drop, which lands as the montage
//   speeds up (MONTAGE_DROP), after which the track simply plays on to the
//   end, under the call to action and the logo, fading out with the scroll.
//
// README.md says how to add one.

/**
 * A track and its beat grid, measured from its audio: a beat every 60 / BPM
 * seconds from `firstBeat`, the beat its calm opening starts on and the beat
 * its drop lands on, a downbeat. The track must run at the grid's BPM.
 */
type Music = {
  /** The file in public/music/, which is git-ignored: licensed music stays out of the repository. */
  file: string;
  firstBeat: number;
  calm: number;
  drop: number;
};

/** The track the video is cut to, or none. */
export const MUSIC: Music | null = null;

/** Where the track's beat `beat` starts, in frames of the video. */
const sourceFrame = (music: Music, beat: number) =>
  Math.round((music.firstBeat + (beat * 60) / BPM) * FPS);

/**
 * The join: the bars before the drop start this many beats early, fading in over
 * the first two while the calm opening fades out over the first three, so the two
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
  if (!MUSIC) {
    return null;
  }
  const src = staticFile(`music/${MUSIC.file}`);
  const padFrames = beats(join + BLEND) - beats(cli.from);
  const blend = beats(join) - beats(cli.from);
  const songFrames = beats(end) - beats(join);
  return (
    <>
      <Sequence name="Calm opening" from={beats(cli.from)} durationInFrames={padFrames}>
        <Audio
          src={src}
          trimBefore={sourceFrame(MUSIC, MUSIC.calm)}
          volume={(frame) => fall((frame - blend) / beats(BLEND))}
        />
      </Sequence>
      <Sequence name="Into the drop and on" from={beats(join)} durationInFrames={songFrames}>
        <Audio
          src={src}
          trimBefore={sourceFrame(MUSIC, MUSIC.drop - LEAD_IN)}
          volume={(frame) =>
            rise(frame / beats(FADE_IN)) *
            fall((frame - (songFrames - beats(FADE_OUT))) / beats(FADE_OUT))
          }
        />
      </Sequence>
    </>
  );
}
