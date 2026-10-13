# Agent Instructions — `apps/website`

The hosted cloud's page at `/`: a coming-soon page built around the new
website's hero animation, with small links to the docs, the console and the
storybook. Read together with the [root `AGENTS.md`](../../AGENTS.md) and
[`apps/AGENTS.md`](../AGENTS.md).

It is the seed of the public website, so it follows `zitadel/new-website`'s
`apps/website`: Next.js with the App Router and Tailwind 4, and that repo's
theme (`packages/theme`) for the look: its colours, APK Futural for headings,
Arimo for text. `app/globals.css` keeps only the values this page uses, under
the website's names (`bg-background`, `text-text-muted`, `accent-strong`), so
the website's components move over unchanged. It does not use
`@zitadel/design-tokens`, the palette of the console and the login.

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

## Routing

The cloud routes only `/` and `/_next/*` to this app (repo-root
[`vercel.json`](../../vercel.json)); every other path belongs to another
service, most of them to the server.

- A new page, or a file in `public/`, needs a rewrite of its own in
  `vercel.json`; without one the server answers its path with a 404.
- Every asset loads from `/_next/`: fonts through `next/font`, images and the
  icon as imports. Not through Next's metadata files (`app/icon.svg`,
  `app/favicon.ico`, `opengraph-image`): Next serves those at the root.
- Links to the other apps are plain `<a>`, never `next/link`: each is a
  deployment of its own, which this app must not prefetch or route to itself.

## Checks

`moon run website:typecheck website:lint website:build`, and
`moon run website:start` to look at the build on port 3004; its links to the
other apps only resolve on the cloud's host. On Vercel the build runs
`pnpm run build`, never moon, as the docs' does.
