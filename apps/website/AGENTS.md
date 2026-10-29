# Agent Instructions — `apps/website`

The hosted cloud's front page at `/` and its changelog at `/changelog`, with
a page per entry and a feed under it.
Shared app rules: [`apps/AGENTS.md`](../AGENTS.md).

- The front page says the benefit, then proves it, and nothing else: the
  hero with the commands, then the showcase's steps, ending on the
  quickstart. Feature lists, ways in and roadmaps belong on the docs and
  zitadel.com.
- It ports `zitadel/new-website`'s narrative redesign
  (`docs/narrative-ia-proposal.md` on that repo's
  `claude/zitadel-narrative-redesign-377a49` branch) and follows that repo's
  `apps/website` (Next.js App Router, Tailwind 4, its `packages/theme`), so
  components move over unchanged. Keep the website's names in
  `app/globals.css` (`bg-background`, `text-foreground`, `text-accent`).
- It does not use `@zitadel/design-tokens`; only the login previews paint with
  them, on the login's own atoms.

## Content-Security-Policy

- The front page renders per request with a nonce (`proxy.ts`,
  `app/csp.ts`); give an inline `<script>` the layout's nonce. The changelog
  is prerendered, so its policy has none: keep `proxy.ts`' list of
  prerendered paths in step with the pages that are.
- The enforced policy is `next.config.ts`', never the proxy's: Next.js would
  read the nonce from it.

## The fonts

- Load every face through `next/font/local` from `app/fonts/`, never
  `next/font/google`: its build-time download has failed builds.
- Each file is the latin subset Google Fonts serves `next/font/google`, byte
  for byte. Keep each SIL OFL license (`*-OFL.txt`) beside its file. APK
  Futural is licensed, not open.
- To update one, take the file under `/* latin */` from the stylesheet served
  to `next/font/google`'s user agent (Azeret Mono's family is
  `Azeret+Mono:wght@500`):

  ```sh
  curl -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36' \
    'https://fonts.googleapis.com/css2?family=Arimo:wght@400..700&display=swap'
  ```

- `apps/docs/app/fonts/` holds the same Arimo file; update both.

## The theme

- Dark and light share one set of names in `app/globals.css`: add a color as
  a token with a value on both sides, never a `white`/`black` literal.
- `app/theme.ts` sets `data-theme` before the first paint, from the header
  toggle's choice or the system's; the login previews follow it.

## The logo and the favicons

- `app/logo.tsx` is the website's animated logo as inline SVG, its motion as
  CSS keyframes in `app/globals.css`. A hover plays it once to the end, and
  with `autoplay` it also plays now and then by itself (the header's and the
  footer's); never for reduced motion. Give each copy its own `id`.
- `apps/docs/components/logo.tsx` is a copy; change the copies together.
- `public/favicons/` and `public/favicon.ico` are the cloud's favicons: the
  console and the docs link the same set, so a change here reaches them. A single `/favicon.ico` cannot replace the light/dark set.
- `layout.tsx` imports the share image (`app/og.jpg`) and sets no
  `metadataBase`: on Vercel, Next makes its URL absolute with the deployment's
  host. Render it from `scripts/og.html` at 1200×630 as a JPEG (quality 88),
  and change both when the hero's title, line or commands change.

## The commands and the showcase

- `app/commands.ts` feeds the hero and `/llms.txt`. The commands follow the
  README's quick start; never add `--force`. When that journey changes,
  change the commands and the showcase, and run them once against the
  published CLI.
- Steps 1 to 4 replay a recorded session (`app/showcase/sessions.ts`).
  Re-record rather than edit when what the CLI prints, the files setup writes
  or the flow format change.
- `login-preview.tsx` draws each login screen from `@zitadel/components`'
  atoms in the default template's English copy. When that copy or a step's
  fields change, change the screens.
- The previews' light-DOM chrome (`login-preview.module.css`) follows
  `packages/components/src/orchestrator/templates/layout-chrome.css`; follow
  its changes.
- The atoms load through one dynamic import once the first preview nears the
  viewport. `brand-tokens.ts` sets their `--zl-*` base layer from the
  package's `tokens` and `cssVars`, the light side from its `tokensCss`; JSX
  types are in `app/zl-elements.d.ts`.
- Every window is `app/window.tsx` and every command line
  `app/command-line.tsx`; colors come from the `@theme` in `app/globals.css`.
- Next resolves `@zitadel/components` to its `dist/`, so `build` and `dev`
  depend on `components:build` in moon and in turbo.

## The changelog

- An entry, `changelog/<slug>.md`, tells one notable change, which an agent
  drafts with `skills/zitadel-changelog-entries`. The GitHub Releases keep
  every change of each version; never list them all here.
- `app/changelog/entries.ts` reads the entries when the site builds, and finds
  the release that ships each one's pull requests in the published packages'
  `CHANGELOG.md`, which `build` lists as inputs in `moon.yml` and
  `turbo.json`. A broken entry fails the build.
- Render an entry's Markdown only through `app/changelog/markdown.tsx`, as
  elements and never as HTML: this origin also serves the console's session.
  The feed carries each entry's plain-text summary instead.
- Keep `metadata.internal` in the skill's `SKILL.md`: it keeps the skill out
  of `npx skills add zitadel/nextgen --full-depth`, the users' install.

## Analytics

- Send a custom event only through `app/analytics.ts`, and list it in
  [`docs/product-analytics-events.yaml`](../../docs/product-analytics-events.yaml) in the same change.

## Routing

The cloud routes only `/`, `/changelog`, `/changelog/*`, `/llms.txt`,
`/_next/*`, `/favicon.ico` and `/favicons/*` here (repo-root
[`vercel.json`](../../vercel.json)).

- A new page or `public/` file outside `/changelog/` needs a rewrite of its own
  in `vercel.json`, or the server answers it with a 404.
- Load every other asset from `/_next/`: fonts through `next/font`, images as
  imports. Never use Next's metadata files (`app/icon.svg`, `opengraph-image`),
  which Next serves at the root.
- Link another app with a plain `<a>` (`app/links.ts`), never `next/link`.
- `/llms.txt` (`app/llms.txt/route.ts`) links paths on the same host.

## Checks

```sh
moon run website:typecheck website:lint website:test website:build
moon run website:start   # the build on port 3004
```

Vercel runs `turbo run build --filter=@zitadel/website`; the build's key
holds the deployment's ID, so Vercel never restores it
([turborepo.md](../../docs/design/build/turborepo.md)).
