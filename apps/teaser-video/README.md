# Login teaser video

A 29.5-second teaser of the Zitadel login, rendered as code with
[Remotion](https://remotion.dev). Every login on screen is the real
`<zl-*>` atoms of `@zitadel/components` with the real `--zl-*` design tokens,
so the video never drifts from the product: change the login, render again.

This README is for anyone who wants to change the video or build another one
on it. The rules an agent (or a careful human) must keep are in
[AGENTS.md](AGENTS.md).

## Run it

```sh
pnpm install
turbo run dev --filter=@zitadel/teaser-video      # Remotion Studio: scrub, preview, tweak
turbo run render --filter=@zitadel/teaser-video   # renders dist/teaser.mp4 (1920×1080, 30 fps)
```

Both tasks build `@zitadel/components` first. The Studio lists one
composition per part, so you can work on one without scrubbing past the rest:

| Composition | What it plays |
| --- | --- |
| `Teaser` | the whole video |
| `TeaserWithMetronome` | the whole video with a click on every beat, to check cuts by ear |
| `Terminal`, `ColdOpen`, `Montage`, `Outro` | one section each, with its slice of the sound |

## What the video shows

The video is cut to a beat grid of 120 BPM: a beat is half a second, a bar two
seconds.

| Time | Section | What happens |
| --- | --- | --- |
| 0:00–0:08 | Terminal | The quick start runs: `start`, `setup`, `npm run dev`, over a soft glow. |
| 0:08–0:12 | Cold open | Close on the email field of the sign-in step; `ada@zitadel.com` is typed. |
| 0:12–0:16 | Montage: identifiers | Same view, the identifier becomes a username, a phone, an employee ID, a customer number, each field restyled. |
| 0:16–0:18.5 | Montage: screens | Whole steps, one a beat: providers, password, error, passkey offer, sign-up. |
| 0:18.5–0:19.5 | Montage: avatar | The account chip, its avatar's gradient moving. |
| 0:19.5–0:21 | Montage: close-ups | Parts of screens, two a beat: providers, passkey prompt, error, checkbox, buttons. |
| 0:21–0:24 | Montage: apps | The login inside six invented apps: a bank, a ticket sale, a travel split screen, a landing page, a dashboard, a checkout. |
| 0:24–0:29.5 | Outro | "Meet the new Zitadel", the start command and the framework and agent marks; the logo; a scroll into a gradient; black. |

## How it is built

```text
src/
  index.ts, root.tsx        compositions, and the order of the sections
  timeline.ts               the beat grid: FPS, BPM, sections, outro moments
  scenes/                   one file per section
    cli.tsx                 the terminal and its commands
    cold-open.tsx           the typed email
    identifier.tsx          the close view of the identifier field, with its caret
    typing.ts               when each key is typed, shared by picture and sound
    montage.tsx             plays the montage's shots back to back
    outro.tsx               the gradient, the logo, the scroll, the fade
    call-to-action.tsx      the closing screen's words, command and marks
  montage/                  the montage's shots
    shots.tsx               the shot list: what each shows, in which brand, for how long
    identifiers.ts          the identifiers after the cold open, with their field styles
    app-scenes.tsx          the six invented apps
    focus-shot.tsx          a camera close on one part of a screen
    avatar-shot.tsx         the moving avatar
    shot.tsx                the shared screen and scene shots, and the wait for the atoms
    atoms.tsx               buttons and providers as the default template sets them
  card.tsx                  a login step as the default template lays it out
  brands.ts                 the looks: theme, brand colour, corners, heading face
  login-surface.tsx/.css    the --zl-* tokens and fonts every login shot stands on
  camera.ts                 the push and the hand-held drift
  glass.ts                  the website's frosted glass
  film-look.tsx             grade, vignette and grain over every frame
  logo.tsx                  the website's animated logo, played by the frame
  freeze-motion.ts          switches off the atoms' own CSS motion
  click-track.tsx           the typing sounds, and the optional metronome
  soundtrack.tsx            the music slot, empty by default
```

Remotion renders the video by taking a screenshot of every frame in a
headless browser. Two consequences shape all of the code:

- **Everything moves by the frame.** A scene reads `useCurrentFrame()` and
  computes where everything is. CSS transitions, timers and the browser's
  own caret would land differently on every render, so the atoms' own
  animations are switched off (`freeze-motion.ts`) and the caret is drawn.
- **Every frame waits for the atoms.** Lit renders a change a moment later,
  so each shot holds its frame until the atoms report `updateComplete`.

## Common edits

**Change words.** The steps' copy follows the login's English
(`packages/components/src/orchestrator/locales/en.ts`); it sits in
`montage/shots.tsx`, the invented apps' copy in `montage/app-scenes.tsx`, the
closing screen's in `scenes/call-to-action.tsx`, the commands in
`scenes/cli.tsx`.

**Change a look.** A brand is a theme, a colour, a corner ramp and a heading
face (`brands.ts`); a shot names its brand. The identifiers also restyle the
field itself through `zl-field`'s CSS parts (`input-wrap`, `input`, `label`),
as an app can: see the `look` of each in `montage/identifiers.ts`.

**Add, drop or reorder a shot.** Edit the list in `montage/shots.tsx`. A
shot's length is in beats (`0.5`, `1`, `2`); the lengths must add up to the
montage's length in `timeline.ts`, and the render stops with a message if
they do not. A new kind of shot is a function from its length to what it
shows; `ScreenShot`, `FocusShot` (mark the part to look at with `data-focus`)
and `Scene` cover most.

**Change the timing.** Sections, the outro's moments and where the montage
speeds up (`MONTAGE_DROP`) are beats in `timeline.ts`. A timing off the grid
is given in seconds with `seconds()`, never as a frame count.

**Change the length.** Change the section lengths in `timeline.ts`; the
total follows.

## Adding music

The video ships without music. To cut it to a track:

1. Put the file in `public/music/`. The folder is git-ignored: licensed music
   must never enter the repository, and every machine that renders needs its
   own copy.
2. Measure the track's beat grid: its tempo, the second of its first beat,
   the beat its calm opening starts on and the beat its drop lands on. A beat
   detector or a DAW gives these; the drop is usually where the kick comes in
   on a downbeat.
3. Set `BPM` in `timeline.ts` to the track's tempo, and `MUSIC` in
   `soundtrack.tsx` to the file name and the three numbers.
4. Check the cuts in `TeaserWithMetronome`: the clicks should sit on the
   track's beats.

The edit plays the calm opening from the start and blends into the bars
before the drop, which lands where the montage speeds up; from there the
track plays on to the end.

## Basing another video on it

Start from a copy of this app. The parts worth keeping as they are: the beat
grid (`timeline.ts`), the wait for the atoms and the shots (`montage/shot.tsx`,
`focus-shot.tsx`), the login surface and brands, the camera, the glass and the
film look. Replace the sections in `root.tsx` and the shot list, and keep
every motion on the frame.

## Before publishing

- **Remotion** needs a paid company license for Zitadel's use.
- **APK Futural**, the closing line's face, is licensed to Zitadel for its own
  sites and video only; it must never move into a published package.
- **Third-party marks** on the closing screen come from Simple Icons; each
  stays its owner's trademark, so check each owner's rules for advertising.
- **The apps** in the montage (Brightwell, Sala Nova, Orbitly, Fernhill,
  Kitebase, Atelier Nord) are invented; keep any new one invented too.
