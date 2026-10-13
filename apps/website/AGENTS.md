# Agent Instructions — `apps/website`

The hosted cloud's page at `/`: a coming-soon page built around the new
website's hero animation, under its animated logo, above the commands that run
the preview locally today. Read together with the
[root `AGENTS.md`](../../AGENTS.md) and [`apps/AGENTS.md`](../AGENTS.md).

It is the seed of the public website, so it follows `zitadel/new-website`'s
`apps/website`: Next.js with the App Router and Tailwind 4, and that repo's
theme (`packages/theme`) for the look: its colours, APK Futural for headings,
Arimo for text, Azeret Mono for code. `app/globals.css` keeps only the values
this page uses, under the website's names (`bg-background`, `text-foreground`,
`accent-strong`), so the website's components move over unchanged. It does not
use `@zitadel/design-tokens`, the palette of the console, the login and the
docs.

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
on it, returns to rest when the pointer leaves, and plays on its own where
nothing hovers; here it also stays still for reduced motion.

`public/favicons/` holds the website's favicons,
`packages/theme/assets/favicons` in `zitadel/new-website`, and
`public/favicon.ico` its light one, laid out and declared (`app/layout.tsx`) as
the website does: a dark mark for a light browser, a light one for a dark
browser. They are the cloud's favicons, not only this page's: the console, the
login UI and the docs link the same set at the same URLs, so a change here
reaches them too; the storybook keeps Storybook's own. A single `/favicon.ico`
cannot stand in for the set: each mark is one flat colour on a transparent
ground, nearly invisible in the other theme's tab bar.

## The commands

Under the caption, `app/page.tsx` shows the local preview as three commands of
the published CLI (`@zitadel/cli@alpha`), with a button that copies them. They
follow the journey of the CLI's skill
([`apps/cli/skills/zitadel-cli/SKILL.md`](../cli/skills/zitadel-cli/SKILL.md))
and the docs' quickstart: a new folder, `start`, then `setup --server local`.
Never `--force`: if `mkdir` fails because the folder exists, the next lines run
in the current directory, where `--force` would replace files. When that
journey changes, change the commands with it, and run them once against the
published CLI before they ship.
Their height is part of the stage's sizing in `app/globals.css`, which keeps
the page on one screen: a line more or less changes it.

## Routing

The cloud routes only `/`, `/_next/*`, `/favicon.ico` and `/favicons/*` to this
app (repo-root [`vercel.json`](../../vercel.json)); every other path belongs to
another service, most of them to the server.

- A new page, or a file in `public/`, needs a rewrite of its own in
  `vercel.json`; without one the server answers its path with a 404.
- Every other asset loads from `/_next/`: fonts through `next/font`, images as
  imports. Not through Next's metadata files (`app/icon.svg`,
  `app/favicon.ico`, `opengraph-image`): Next serves those at the root.
- A link to another app is a plain `<a>`, never `next/link`: each is a
  deployment of its own, which this app must not prefetch or route to itself.

## Checks

`moon run website:typecheck website:lint website:build`, and
`moon run website:start` to look at the build on port 3004. On Vercel the
build runs `pnpm run build`, never moon, as the docs' does.
