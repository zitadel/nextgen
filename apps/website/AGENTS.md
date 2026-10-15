# Agent Instructions — `apps/website`

The hosted cloud's front page at `/`, the preview's front door: under a header
to the docs, the storybook and GitHub, the promise of `VISION.md` around the new
website's hero animation, the commands that run the preview locally today, and
the buttons to the quickstart and the repository; below them the four pillars
with what ships and what is planned, a brand playground built from
`@zitadel/components`, and what the preview offers agents. Read together with
the [root `AGENTS.md`](../../AGENTS.md) and [`apps/AGENTS.md`](../AGENTS.md).

It is the seed of the public website, so it follows `zitadel/new-website`'s
`apps/website`: Next.js with the App Router and Tailwind 4, and that repo's
theme (`packages/theme`) for the look: its colours, APK Futural for headings,
Arimo for text, Azeret Mono for code. `app/globals.css` keeps only the values
this page uses, under the website's names (`bg-background`, `text-foreground`,
`accent-strong`), so the website's components move over unchanged. It does not
use `@zitadel/design-tokens`, the palette of the console, the login and the
docs; the brand playground's preview is the one place their tokens paint, on
the login's own atoms (below).

## The fonts

All three faces load through `next/font/local` from `app/fonts/`, so the build
fetches nothing. `next/font/google`, which `zitadel/new-website` still uses for
Arimo and Azeret Mono, downloads them from Google at build time, and that
download has failed builds: Google served a CI runner font URLs that Turbopack
cannot parse, and a local build stalls when the network blips.

- `Arimo-latin.woff2` is Arimo's variable font, every weight from 400 to 700,
  and `layout.tsx` declares it as such, as the docs do: the page sets text at
  400 and 600, the playground's card title at 500.
  `AzeretMono-Medium-latin.woff2` is Azeret Mono at 500.
- Each is the latin subset, byte for byte the file Google Fonts serves
  `next/font/google` (Arimo v36, Azeret Mono v21). A character outside it
  draws in the next face of the stack.
- Both are under the SIL Open Font License 1.1, which has to travel with the
  files: `Arimo-OFL.txt` and `AzeretMono-OFL.txt` beside them, as Google Fonts
  publishes them. APK Futural is a licensed webfont, not an open one.

To update one, fetch the stylesheet with the user agent `next/font/google`
sends and take the file under `/* latin */`:

```sh
curl -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36' \
  'https://fonts.googleapis.com/css2?family=Arimo:wght@400..700&display=swap'
```

Azeret Mono's is `family=Azeret+Mono:wght@500`. The docs keep a copy of the
same Arimo file (`apps/docs/app/fonts/`); update both.

## The animation

`app/hero.avif` is the website's homepage hero, the Lottie
`public/cms/homepage-hero-opt.json` in `zitadel/new-website`. That Lottie holds
no vectors, only 217 WebP frames (each asset's `p` is a base64 data URL), so it
ships here as an animated AVIF: 49 KB instead of 907 KB, no player library, and
the page's two copies of it, the animation and its blurred light, play in step.
`app/hero-still.webp`, its first frame, stands in for reduced motion and for
browsers without AVIF. From the extracted frames:

```sh
ffmpeg -framerate 30 -i %03d.webp -c:v libsvtav1 -crf 34 -preset 4 -pix_fmt yuv420p -f avif hero.avif
```

## The logo and the favicons

`app/logo.tsx` is the website's animated logo, the Lottie
`public/cms/zitadel-hover-alpha-opt.json`. Unlike the hero, it holds only
vectors: the icon turns once, then the letters roll down one after another. It
ships as inline SVG in the Lottie's own coordinates, its paths taken from the
Lottie's shapes, and its motion as CSS keyframes in `app/globals.css` with the
Lottie's timings and easings. As on the website it plays while the pointer is
on it and returns to rest when the pointer leaves; here it also stays still
for reduced motion. It sits in the header, the footer and the playground's
trustmark, so it never plays on its own, where nothing hovers, as the
centrepiece of the coming-soon page did. Its `id` keeps each copy's SVG ids
apart.

`public/favicons/` holds the website's favicons,
`packages/theme/assets/favicons` in `zitadel/new-website`, and
`public/favicon.ico` its light one, laid out and declared (`app/layout.tsx`) as
the website does: a dark mark for a light browser, a light one for a dark
browser. They are the cloud's favicons, not only this page's: the console, the
login UI and the docs link the same set at the same URLs, so a change here
reaches them too; the storybook keeps Storybook's own. A single `/favicon.ico`
cannot stand in for the set: each mark is one flat colour on a transparent
ground, nearly invisible in the other theme's tab bar.

`app/og.jpg`, the share image, is the website's own,
`public/cms/og-zitadel-homepage.jpg` in `zitadel/new-website`: the logo on the
brand's ground, nothing the preview would have to change. `layout.tsx` imports
it, so it loads from `/_next/`, and sets no `metadataBase`: on Vercel, Next
makes its URL absolute with the deployment's own host (`VERCEL_BRANCH_URL` on
a preview, `VERCEL_PROJECT_PRODUCTION_URL` on production); a local build warns
and uses `localhost`.

## The commands

Under the caption and its lead, `app/page.tsx` shows the local preview as
three commands of the published CLI (`@zitadel/cli@alpha`), with a button that
copies them; `/llms.txt` hands the same ones to agents. Both take them from
`app/commands.ts`. They follow the journey of the CLI's skill
([`apps/cli/skills/zitadel-cli/SKILL.md`](../cli/skills/zitadel-cli/SKILL.md))
and the docs' quickstart: a new folder, `start`, then `setup --server local`.
Never `--force`: if `mkdir` fails because the folder exists, the next lines run
in the current directory, where `--force` would replace files. When that
journey changes, change the commands with it, and run them once against the
published CLI before they ship.
Their height is part of the stage's sizing in `app/globals.css`, which keeps
the hero on a laptop's screen: a line more or less changes it.

## The pillars

`app/pillars.tsx` lays out the four pillars of the root
[`VISION.md`](../../VISION.md), each with its items marked Shipped or Planned
as that file's "Where it stands" says. When that section changes, change the
cards with it, and claim nothing it does not.

## The brand playground

`app/brand-playground.tsx` lets a visitor pick a brand colour, the corners and
a heading face; `app/brand-preview.tsx` paints the result on the first step of
the default login, sign-in by email, built from the atoms of
`@zitadel/components` (`zl-card`, `zl-field`, `zl-button`) in their English
copy, and the stylesheet beside it shows the rule an app would set on
`<zitadel-login>`, as the docs' "Customize the design" page themes it.

- The atoms load, through a dynamic import, only once the preview nears the
  viewport. Nothing submits: there is no server behind them.
- An atom reads the `--zl-*` properties from its ancestors, and on its own
  brings none: `app/brand-tokens.ts` sets the base layer on the preview's
  wrapper from the package's own `tokens` and `cssVars` (every token at its
  dark value, under the name the generated stylesheet gives it), and the
  visitor's choices over it.
- The card's title, subtitle, field group, actions and register line are light
  DOM, styled in `app/brand-preview.module.css` as the orchestrator's layout
  chrome styles them
  (`packages/components/src/orchestrator/templates/layout-chrome.css`). When
  that chrome, the default template or its English copy changes, follow it.
- JSX for the atoms is in `app/zl-elements.d.ts`, typed from the atoms'
  classes; the package types only its orchestrators for React.
- Next resolves the package to its `dist/`, so the website's build and dev
  tasks depend on `components:build` in moon and in turbo, and the Vercel
  service builds it through turbo before its own `pnpm run build` (Checks).

## llms.txt

`app/llms.txt/route.ts` serves the host's `/llms.txt`: what the preview is,
the commands, the skills, and where an agent reads on, starting with the docs'
own `/docs/llms.txt`. Its links are paths on the same host.

## Routing

The cloud routes only `/`, `/llms.txt`, `/_next/*`, `/favicon.ico` and
`/favicons/*` to this app (repo-root [`vercel.json`](../../vercel.json)); every
other path belongs to another service, most of them to the server.

- A new page, or a file in `public/`, needs a rewrite of its own in
  `vercel.json`; without one the server answers its path with a 404.
- Every other asset loads from `/_next/`: fonts through `next/font`, images as
  imports. Not through Next's metadata files (`app/icon.svg`,
  `app/favicon.ico`, `opengraph-image`): Next serves those at the root.
- A link to another app is a plain `<a>`, never `next/link`: each is a
  deployment of its own, which this app must not prefetch or route to itself.
  `app/links.ts` holds them.

## Checks

`moon run website:typecheck website:lint website:build`, and
`moon run website:start` to look at the build on port 3004. On Vercel the
service runs `turbo run build --filter=@zitadel/components`, then
`pnpm run build`: the package's build goes through turbo and the team's remote
cache, as the storybook's does, and the Next build itself never through a task
runner, as the docs' does.
