# Sign-in by your agent (video)

A one-minute 1920×1080 video: a coding agent adds sign-up and login to an app it
built, then makes the sign-in match the app. `index.html` draws any moment of it
(`window.seek(t)`), and `scripts/render.mjs` steps through the frames and encodes
them with ffmpeg.

## Render

```sh
node scripts/render.mjs             # → out/login-video.mp4 (60.7 s)
node scripts/render.mjs --at 5,40   # stills in out/stills/
node scripts/render.mjs --mux       # new music on the last render, no frames
```

It needs `ffmpeg` on PATH and the repo's `node_modules` (Playwright from `e2e`).

## Story

The app (Crux, a bouldering gym's bookings) and "Your agent built the app. Now it
needs sign-in." Prompt 1, "Add sign-up and login with Zitadel.", plays in the
agent pane while the browser picks up the new header links, then lands on a
working but generic `/register`. Prompt 2, "Make it match the rest of the app.",
restyles it; the sign-up then runs in Crux's design and ends signed in. "Fits any
app." shows the same sign-in in four other designs, then the close ("You own the
whole experience. Zitadel owns the rest.") and the end card with
`npx @zitadel/cli@latest skills add`. Captions are one label style, top left.

## Look

Fonts and logo come from `apps/website`. Colors and graphics follow Lightbox's
Brand Guidelines (Figma "Brand Guidelines - Client"): orange `#F25543` is the
highlight, the brand's purple (`#6a4cc2`, `#401889`) carries the light from
above, and the background has the gradient light with noise. The website's hero
Lottie (`/cms/homepage-hero-opt.json` on the Lightbox site) plays behind the end
card; `capture/lottie/hero/` holds its 217 frames.

## Music

"Launch Sequence" (`audio/track.mp3`) is AI-generated for this video; other
files in `audio/` stay out of git. It is 63.6 s at 125.7 BPM and plays straight
through, with a short fade-in and a 2 s fade-out. `MUSIC` in `timeline.js` holds
its measured grid and the schedule sits on its bars (prompt 1 where the groove
comes in, signed in on the dip, "Fits any app." where it returns, "rest." on the
break, the logo on the last hit). `schedule.music.edl` can splice source bars and
`music.filter` can hold a low-pass envelope for a track that needs either.

## What is real

- The agent's runs: Claude Code, headless, recorded with `scripts/agent-rec.py`
  (each event timestamped; only the Zitadel CLI, npm, git and file tools allowed,
  in the app's folder). `scripts/build-agent.py` turns them into `data/agent.js`:
  the run's order and real times, its sentences (first sentence each), CLI
  commands, edited files and checks; reads and refused attempts fold into "Read n
  files". The pane plays each run faster than real time, and its title bar shows
  the real elapsed time. The recordings stay out of git: they hold the files the
  agent read and the project's credentials.
- The app: Crux was built by the same agent from `create-next-app`, and the
  Zitadel skills were added with `npx @zitadel/cli@0.9.0 skills add`, both before
  the recorded prompts.
- Every browser frame: screenshots of that app after each run
  (`capture/shots/agent/`, `scripts/capture-page.mjs`, `capture-ladder.mjs` and
  `capture-agent-signup.mjs`, which signs up for real).
- "Fits any app.": each brand was deployed with the CLI to one scaffolded app and
  its register page captured (`scripts/ladder.py`); the two whole pages are that
  app's own register page around the widget (`capture/app/*-register-page.tsx`).
  The brands and their logos (`capture/app/public/`) are made up.

## Re-record

1. `npx create-next-app@latest crux --yes`, then build the app with an agent
   prompt (`scripts/agent-rec.py <app> <out.jsonl> "<prompt>" --tools …`, with
   `CLAUDE_BIN` pointing at Claude Code), and add the skills with
   `npx @zitadel/cli@latest skills add`. Keep port 3000 free while recording.
2. Record prompt 1, then prompt 2 with `--resume <prompt 1's session id>`.
3. Run `npm run dev`, capture the screens, and run
   `python3 scripts/build-agent.py <app> <prompt1.jsonl> <prompt2.jsonl>`.
4. For "Fits any app.", run a scaffolded app's server and `npm run dev`, then
   `python3 scripts/ladder.py <app> b1-fernhill b3-signal p1-orbitly p2-kiln`.
