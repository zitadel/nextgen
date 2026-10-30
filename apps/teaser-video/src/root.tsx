import { Composition, Sequence } from "remotion";

import { ClickTrack } from "./click-track";
import { FilmLook } from "./film-look";
import { Cli } from "./scenes/cli";
import { ColdOpen } from "./scenes/cold-open";
import { Outro } from "./scenes/outro";
import { Montage } from "./scenes/montage";
import { Soundtrack } from "./soundtrack";
import { FPS, HEIGHT, SECTIONS, TOTAL_BEATS, WIDTH, beats } from "./timeline";

// The whole teaser, again with the metronome over its music to check the cuts
// by ear, and each section on its own with its slice of the sound, to work on
// one without scrubbing past the others.

function Sound({ metronome = false }: { metronome?: boolean }) {
  return (
    <>
      <Soundtrack />
      <ClickTrack metronome={metronome} />
    </>
  );
}

function Teaser({ metronome = false }: { metronome?: boolean }) {
  const { cli, coldOpen, montage, outro } = SECTIONS;
  return (
    <FilmLook>
      <Sequence from={beats(cli.from)} durationInFrames={beats(cli.length)} name="Terminal">
        <Cli />
      </Sequence>
      <Sequence
        from={beats(coldOpen.from)}
        durationInFrames={beats(coldOpen.length)}
        name="Cold open"
      >
        <ColdOpen />
      </Sequence>
      <Sequence from={beats(montage.from)} durationInFrames={beats(montage.length)} name="Montage">
        <Montage />
      </Sequence>
      <Sequence from={beats(outro.from)} durationInFrames={beats(outro.length)} name="Outro">
        <Outro />
      </Sequence>
      <Sound metronome={metronome} />
    </FilmLook>
  );
}

function Section({ name, children }: { name: keyof typeof SECTIONS; children: React.ReactNode }) {
  return (
    <FilmLook>
      {children}
      <Sequence from={-beats(SECTIONS[name].from)} layout="none">
        <Sound />
      </Sequence>
    </FilmLook>
  );
}

const video = { fps: FPS, width: WIDTH, height: HEIGHT };

export function Root() {
  return (
    <>
      <Composition
        id="Teaser"
        component={Teaser}
        durationInFrames={beats(TOTAL_BEATS)}
        {...video}
      />
      <Composition
        id="TeaserWithMetronome"
        component={() => <Teaser metronome />}
        durationInFrames={beats(TOTAL_BEATS)}
        {...video}
      />
      <Composition
        id="Terminal"
        component={() => (
          <Section name="cli">
            <Cli />
          </Section>
        )}
        durationInFrames={beats(SECTIONS.cli.length)}
        {...video}
      />
      <Composition
        id="ColdOpen"
        component={() => (
          <Section name="coldOpen">
            <ColdOpen />
          </Section>
        )}
        durationInFrames={beats(SECTIONS.coldOpen.length)}
        {...video}
      />
      <Composition
        id="Montage"
        component={() => (
          <Section name="montage">
            <Montage />
          </Section>
        )}
        durationInFrames={beats(SECTIONS.montage.length)}
        {...video}
      />
      <Composition
        id="Outro"
        component={() => (
          <Section name="outro">
            <Outro />
          </Section>
        )}
        durationInFrames={beats(SECTIONS.outro.length)}
        {...video}
      />
    </>
  );
}
