import { useMemo } from "react";
import { Audio, random } from "remotion";

import { IDENTIFIER_BEATS, IDENTIFIERS } from "./montage/identifiers";
import { CLI_KEYS } from "./scenes/cli";
import { CUTS } from "./scenes/montage";
import { ENTER, KEYSTROKES } from "./scenes/typing";
import { BEATS_PER_BAR, FPS, OUTRO, SECTIONS, TOTAL_BEATS, beats } from "./timeline";

// The sounds the video makes itself, over the music (soundtrack.tsx): the
// keystrokes and Enters of the terminal's commands, of the cold open and of
// the identifiers after it. With `metronome`, also the grid the
// music is cut to, for checking a cut by ear: a click on every beat (higher on
// each bar's downbeat), soft under the cold open, a tick on every montage cut
// between the beats, and a low hit as the logo replaces the call to action.
// It is synthesised from the beat grid as a WAV data URL, so there is no audio
// file to keep in step with timeline.ts.

const RATE = 48000;

type Sound = (t: number, noise: () => number) => number;

const click =
  (pitch: number, gain: number): Sound =>
  (t) =>
    t > 0.04 ? 0 : gain * Math.sin(2 * Math.PI * pitch * t) * Math.exp(-t / 0.01);

const key =
  (gain: number): Sound =>
  (t, noise) =>
    t > 0.03
      ? 0
      : gain * (noise() * 0.7 + 0.3 * Math.sin(2 * Math.PI * 2600 * t)) * Math.exp(-t / 0.005);

const enter: Sound = (t, noise) =>
  t > 0.12
    ? 0
    : 0.28 * noise() * Math.exp(-t / 0.012) +
      0.3 * Math.sin(2 * Math.PI * 170 * t) * Math.exp(-t / 0.04);

// A sine falling from 90 Hz to 45 Hz as it fades: a hit felt more than heard.
const hit: Sound = (t) =>
  t > 1.6
    ? 0
    : 0.9 *
      Math.sin(2 * Math.PI * (45 * t + (45 / 6) * (1 - Math.exp(-6 * t)))) *
      Math.exp(-t / 0.45);

type Cue = { frame: number; sound: Sound };

function cues(metronome: boolean): Cue[] {
  const list: Cue[] = [];
  for (const { keys, enter: enterAt } of CLI_KEYS) {
    for (const frame of keys) {
      list.push({ frame: beats(SECTIONS.cli.from) + frame, sound: key(0.1) });
    }
    list.push({ frame: beats(SECTIONS.cli.from) + enterAt, sound: enter });
  }
  for (const frame of KEYSTROKES) {
    list.push({ frame: beats(SECTIONS.coldOpen.from) + frame, sound: key(0.14) });
  }
  list.push({ frame: beats(SECTIONS.coldOpen.from) + ENTER, sound: enter });
  IDENTIFIERS.forEach(({ keys }, index) => {
    const from = beats(SECTIONS.montage.from + index * IDENTIFIER_BEATS);
    for (const frame of keys) {
      list.push({ frame: from + frame, sound: key(0.1) });
    }
  });
  if (!metronome) {
    return list;
  }
  for (let beat = 0; beat < SECTIONS.outro.from; beat++) {
    const downbeat = beat % BEATS_PER_BAR === 0;
    const gain = beat < SECTIONS.montage.from ? 0.12 : 0.35;
    list.push({ frame: beats(beat), sound: click(downbeat ? 1600 : 1000, gain) });
  }
  // A tick on every montage cut between the beats, so the faster cuts can be
  // judged against the grid.
  for (const cut of CUTS) {
    if (cut % 1 !== 0) {
      list.push({ frame: beats(SECTIONS.montage.from + cut), sound: click(5200, 0.12) });
    }
  }
  list.push({ frame: beats(SECTIONS.outro.from + OUTRO.logo), sound: hit });
  return list;
}

function wav(samples: Float32Array): string {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(at + index, text.charCodeAt(index));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped * 0x7fff, true);
  });
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** The whole video's sounds, as a WAV data URL. */
function render(metronome: boolean): string {
  const samples = new Float32Array(Math.round((beats(TOTAL_BEATS) / FPS) * RATE));
  cues(metronome).forEach(({ frame, sound }, index) => {
    // Seeded, so every render sounds alike.
    let draw = 0;
    const noise = () => random(`noise-${index}-${draw++}`) * 2 - 1;
    const offset = Math.round((frame / FPS) * RATE);
    for (let at = Math.max(0, offset); at < samples.length; at++) {
      const value = sound((at - offset) / RATE, noise);
      if (value === 0 && at - offset > RATE * 0.05) {
        break;
      }
      samples[at] = (samples[at] ?? 0) + value;
    }
  });
  return wav(samples);
}

export function ClickTrack({ metronome = false }: { metronome?: boolean }) {
  const src = useMemo(() => render(metronome), [metronome]);
  return <Audio src={src} />;
}
