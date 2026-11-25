# Agent Instructions — `apps/teaser-video`

The login teaser video, rendered with [Remotion](https://remotion.dev) from the
real atoms of `@zitadel/components`. Not deployed and not published. How it is
built and how to edit it: [README.md](README.md).

```sh
moon run teaser-video:dev      # Remotion Studio, to scrub and preview
moon run teaser-video:render   # dist/teaser.mp4
```

- Drive every motion from `useCurrentFrame()`. Remotion screenshots each
  frame, so a CSS transition, a timer or the native caret renders differently
  every time.
- Place every cut, keystroke and hit in beats through `src/timeline.ts`; a new
  track changes `BPM` there, never a frame number in a scene.
- Give a timing off the beat grid in seconds through `seconds()`, never a raw
  frame count, so a change of `FPS` keeps it.
- Force an atom's interaction state with its stories-only `data-state`
  attribute, never with real focus or hover.
- `src/freeze-motion.ts` switches off the atoms' own transitions and
  animations; import it before the atoms, and animate by the frame instead.
- A frame that depends on a Lit update waits for `updateComplete` behind
  `delayRender`; Lit renders a property change a microtask later.
- Never commit music or name a licensed track in the code: tracks live in the
  git-ignored `public/music/`, wired through `MUSIC` in `src/soundtrack.tsx`.
- Check a cut by ear in the `TeaserWithMetronome` composition, which plays the
  beat grid over the music.
- `src/fonts/APK-Futural-Regular.woff2` is the website's licensed heading
  face, licensed for the video too; never move it into a published package.
- `src/logo.tsx` is a copy of the website's logo
  ([rule](../website/AGENTS.md#the-logo-and-the-favicons)).
- `src/brands.ts` follows the website's
  `apps/website/app/showcase/brand-tokens.ts`; the montage's copy follows the
  default template's `locales/en.ts`.
- `src/login-surface.css` follows
  `packages/components/src/orchestrator/templates/layout-chrome.css`.
- Remotion needs a paid company license for Zitadel's use
  ([license](https://www.remotion.dev/license)).
