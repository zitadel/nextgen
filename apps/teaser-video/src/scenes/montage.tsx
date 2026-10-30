import { Sequence, useCurrentFrame } from "remotion";

import { Shot } from "../montage/shot";
import { SHOTS, type ShotSpec } from "../montage/shots";
import { SECTIONS, beats } from "../timeline";

// The montage: the shots back to back, each cut on the beat grid.

/** Where each shot starts, in beats from the montage's start; the last entry is its end. */
export const CUTS = [0];
for (const shot of SHOTS) {
  CUTS.push((CUTS.at(-1) ?? 0) + shot.beats);
}

if (CUTS.at(-1) !== SECTIONS.montage.length) {
  throw new Error(
    `The montage's shots last ${CUTS.at(-1)} beats, its section ${SECTIONS.montage.length}`,
  );
}

export function Montage() {
  return (
    <>
      {SHOTS.map((shot, index) => {
        const from = beats(CUTS[index] ?? 0);
        const length = beats(CUTS[index + 1] ?? 0) - from;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered
          <Sequence key={index} from={from} durationInFrames={length} name={`Shot ${index + 1}`}>
            <PlayedShot shot={shot} length={length} />
          </Sequence>
        );
      })}
    </>
  );
}

function PlayedShot({ shot, length }: { shot: ShotSpec; length: number }) {
  const frame = useCurrentFrame();
  if ("scene" in shot) {
    return <>{shot.scene(length)}</>;
  }
  return (
    <Shot brand={shot.brand} length={length} scale={shot.scale} push={shot.push}>
      {shot.content(frame)}
    </Shot>
  );
}
