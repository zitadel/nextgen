# Login in a minute (video)

A one-minute 1920×1080 video built from a real run of the published CLI.
`index.html` draws any moment of it (`window.seek(t)`), and `scripts/render.mjs`
steps through the frames and encodes them with ffmpeg.

## Render

```sh
python3 scripts/build-terminal.py   # capture/rec → data/terminal.js
node scripts/render.mjs             # → out/login-video.mp4 (60.7 s)
node scripts/render.mjs --at 5,40   # stills in out/stills/
```

It needs `ffmpeg` on PATH and the repo's `node_modules` (Playwright from `e2e`).

## Story

Four bars of title ("Give us a minute.", the cover's fan, then the minute as a
ring of twelve shards that shrinks into the build clock, a quiet timestamp), the
real build (12 bars), sign-in,
"Now make it yours.", the brand ladder, the close ("You own the whole experience.
Zitadel owns the …"), and the end card on the music's last hit.

The ladder shows how far the sign-in goes, one labeled rung at a time: a color
(`branding.json` palette only), a font and a logo (`branding.json`), the fields
(`flows/default-login.json`), and the page and its layout (`app/register/page.tsx`
around the widget: Orbitly with the form on the right, Kiln with it on the left).
Captions are one label style, top left; the build clock sits top right.

## Look

Fonts and logo come from `apps/website`. Colors and graphics follow Lightbox's
Brand Guidelines (Figma "Brand Guidelines - Client"): orange `#F25543` is the
highlight, the brand's purple (`#6a4cc2`, `#401889`, lilac `#bba5e4`, from the
website) carries the light from above and the shapes, and the background has the
gradient light with noise. Each graphic appears once: the cover's blade fan, the
"Gradient Shape" ring of shards (the minute), its rosette
(the turn), its stack of rings (a ring per word in the close), and the website's
hero Lottie (`/cms/homepage-hero-opt.json` on the Lightbox site) on the end card.
The Lottie is an image sequence, so `capture/lottie/hero/` holds its 217 frames.

## Music

"Launch Sequence" (`audio/track.mp3`) is AI-generated for this video; other
files in `audio/` stay out of git. It is 63.6 s at 125.7 BPM and
plays straight through: `MUSIC` in `timeline.js` holds its measured grid, and the
schedule sits on its bars (the first command where the groove comes in, "Now make
it yours." in the dip, the ladder where the groove returns, the logo on the last
hit). `schedule.music.edl` can splice source bars for a track that needs an edit.
The song plays as delivered, with a short fade-in and a 2 s fade-out at the end;
`music.filter` can hold a low-pass envelope for a track that needs one (empty for
this one). `node scripts/render.mjs --mux` puts new music on the last render
without rendering the frames again.

## What is real

- Terminal output and its timing: `capture/rec/*.jsonl`, recorded with
  `scripts/ptyrec.py` from `npx @zitadel/cli@latest start`, `setup --framework next
  --server local` (answers: defaults, then Yes to "continue without SSO") and
  `npm run dev`, on warm npm caches.
- Every browser frame of the build: `capture/shots/signup/`, screenshots of the
  scaffolded app (`scripts/capture-signup.mjs`).
- The ladder: each rung was deployed with the CLI to one scaffolded app and its
  register page captured (`scripts/ladder.py` with `scripts/capture-ladder.mjs`);
  the two whole pages are that app's own register page around the widget
  (`capture/app/*-register-page.tsx`); the brands and their logos
  (`capture/app/public/`) are made up.
- Four waits that show only a spinner (setup starting, scaffolding, npm install,
  the first page compile) play at 4×; the clock keeps real build time and its
  badge reads "4× SPEED" while they play.
- A person's part is paced, not recorded: pasting a command and pressing Enter
  (0.35 s), reading before the next command (0.8 s), and the browser steps
  marked "person" in `timeline.js`.

## Re-record

Run in an empty folder named `myapp`, with `ZITADEL_TELEMETRY_ENV=development`:
`python3 scripts/ptyrec.py <out.jsonl> <dir> <max_s> <idle_s> -- <command>`, with
`ANSWERS` set for prompts that must not take the default. Then capture the
screens with the capture scripts and rebuild `data/terminal.js`. For the ladder,
run the app's local server and `npm run dev`, then `python3 scripts/ladder.py <app>`.
