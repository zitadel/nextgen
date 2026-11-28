# Agent Instructions — `apps/website`

The hosted cloud's front page at `/`, a page per phase (`/get-started`,
`/operate`, `/investigate`, `/govern`) and per feature (`/platform/*`), its
changelog at `/changelog`, with a page per entry and a feed under it, and the
guide to choosing it or Zitadel v4 at `/choose-version`.
Shared app rules: [`apps/AGENTS.md`](../AGENTS.md).

- The front page says your agent can do the auth work and shows how, in
  this order and nothing else: the hero (title, line, the asks it takes, the
  start window with your agent's tab first, Start in our cloud and Run it
  yourself), the work (each phase's first exchange, linking its page), What
  your agent can turn on (the features by group, each with a window and its
  page), You stay in charge (beside the change history), the questions, and
  a closing band with both ways to start and Talk to us.
- What Zitadel Next is lives in `app/message.ts`: the description, the share
  image, `/llms.txt` and the first question's answer, not the hero's line.
- A front-page window renders what another page shows, from the same data or
  component, never a copy: a feature's is its Under the hood
  (`app/hoods.tsx`), Sign-in's the live login.
- Keep the showcase's walkthrough, logos, badges and star counts off the front
  page: the walkthrough is `/get-started`; roadmaps belong on the docs and
  zitadel.com.
- Every phase page (`app/phases.ts`, which holds its asks) has the same parts
  (`app/phase-page.tsx`): the title with the phases' stepper and what your
  agent does, Ask it, Under the hood, You decide, Try it, Questions, and the
  phase after it. `/get-started` shows the quickstart's walkthrough, the
  hero's commands then the showcase, in place of Under the hood and Try it.
- Every feature page (`app/platform.ts`) has the same seven parts
  (`app/feature-page.tsx`): its group, title and line, What you get, Ask your
  agent, Under the hood, Try it, Questions, and Related.
- Under the hood shows one real thing from this repo, taken from code or
  docs; Try it only commands that work now (README, the CLI skill, `--help`).
- "Solutions" is kept for use-case pages (B2B SaaS, consumer apps, agents and
  MCP); a feature goes under Platform.
- The header's links and menus of groups come from `app/nav.ts`: add a menu,
  a group or a link there, never in `site-header.tsx`.
- The footer's menu columns, `/platform` and `/llms.txt` read the same data.
- It ports `zitadel/new-website`'s narrative redesign
  (`docs/narrative-ia-proposal.md` on that repo's
  `claude/zitadel-narrative-redesign-377a49` branch) and follows that repo's
  `apps/website` (Next.js App Router, Tailwind 4, its `packages/theme`), so
  components move over unchanged. Keep the website's names in
  `app/globals.css` (`bg-background`, `text-foreground`, `text-accent`).
- It does not use `@zitadel/design-tokens`; only the login previews paint with
  them, on the login's own atoms.

## Content-Security-Policy

- `csp-adapter.mjs` enforces each prerendered page's script hashes, and the
  404's for other URLs in place of `next.config.ts`' scriptless fallback.
- Never give a page a nonce or `'unsafe-inline'`: pages, the changelog too,
  stay prerendered ([why](../../docs/design/cloud/csp-docs-and-website.md)).
- `csp-adapter.mjs` copies `apps/docs/csp-adapter.mjs` but for the policy:
  change both.
- Load nothing from another origin without widening the enforced policy
  in the same change.
- The cloud's deployment checks (`e2e/console/src-deployment/routes.spec.ts`)
  fail a page with an unhashed inline script.

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
- Build from the site's own pieces (windows, command blocks, the steps' labels
  and hairlines, the display title): no colored card borders and no color per
  section or phase. Zitadel's orange is the one accent, as the title and the
  steps use it, and no brand color marks state, such as the current page.
- `app/theme.ts` sets `data-theme` before the first paint, from the header
  toggle's choice or the system's; the login previews follow it.

## The logo and the favicons

- `app/logo.tsx` is the website's animated logo as inline SVG, its motion as
  CSS keyframes in `app/globals.css`. A hover plays it once to the end, and
  with `autoplay` it also plays now and then by itself (the header's and the
  footer's); never for reduced motion. Give each copy its own `id`.
- `apps/docs/components/logo.tsx` and `apps/console/src/app-shell/logo.tsx` are
  copies; change the copies together.
- `public/favicons/` and `public/favicon.ico` are the cloud's favicons: the docs
  link the same set, so a change here reaches them. `apps/console/public/favicons/`
  is a copy; change the copies together. A single `/favicon.ico` cannot replace
  the light/dark set.
- `layout.tsx` imports the share image (`app/og.jpg`) and sets no
  `metadataBase`: on Vercel, Next makes its URL absolute with the deployment's
  host. Render it from `scripts/og.html` at 1200×630 as a JPEG (quality 88),
  and change both when the hero's title, `app/message.ts`'s sentence or the
  quickstart's commands change.

## The commands and the showcase

- `app/commands.ts` holds every command and ask the site shows. Its
  `quickstart`, on `/get-started` and in the hero's terminal tab, follows the
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
  depend on `@zitadel/components#build`.

## The changelog

- An entry, `changelog/<slug>.md`, tells one notable change, which an agent
  drafts with `skills/zitadel-changelog-entries`. The GitHub Releases keep
  every change of each version; never list them all here.
- `app/changelog/entries.ts` reads the entries when the site builds, and finds
  the release that ships each one's pull requests in the published packages'
  `CHANGELOG.md`, which `build` lists as inputs in `turbo.json`. A broken
  entry fails the build.
- Render an entry's Markdown only through `app/changelog/markdown.tsx`, as
  elements and never as HTML: this origin also serves the console's session.
  The feed carries each entry's plain-text summary instead.
- Keep `metadata.internal` in the skill's `SKILL.md`: it keeps the skill out
  of the users' installs, `zitadel skills add` and
  `npx skills add zitadel/nextgen --full-depth`.

## Analytics

- Send a custom event only through `app/analytics.ts`, and list it in
  [`docs/product-analytics-events.yaml`](../../docs/product-analytics-events.yaml) in the same change.

## Choose a version

- `app/choose-version/features.ts` holds every row, the guide above them
  (`CHOOSE`) and the date shown (`UPDATED`). Change all three when a feature
  ships or changes.

## Routing

The cloud routes every path no other service claims here (repo-root
[`vercel.json`](../../vercel.json)), so `app/not-found.tsx` answers what
nothing serves ([ADR 076](../../docs/adrs/076-error-pages-and-unmatched-routes.md) §4).

- A new page needs no rewrite, but must keep off the paths other services
  claim: `/api/`, `/console/`, `/docs`, `/cloud/`, `/schemas/v1/`, the
  server's root paths and the API's resource names (`vercel.json`).
- Load every other asset from `/_next/`: fonts through `next/font`, images as
  imports. Never use Next's metadata files (`app/icon.svg`, `opengraph-image`),
  which Next serves at the root.
- Link another app with a plain `<a>` (`app/links.ts`), never `next/link`.
- `/llms.txt` (`app/llms.txt/route.ts`) links paths on the same host.
- `/robots.txt` and `/sitemap.xml` (`app/crawlers.ts`) speak for the whole
  host; only production's build lets crawlers in. List a new page there.
- `/.well-known/security.txt` redirects to zitadel.com's (`next.config.ts`),
  the source `SECURITY.md` names; never serve a copy.

## Checks

```sh
turbo run typecheck lint test build --filter=@zitadel/website
turbo run start --filter=@zitadel/website   # the build on port 3004
```

Vercel runs `turbo run build --filter=@zitadel/website`; the build's key
holds the deployment's ID, so Vercel never restores it
([turborepo.md](../../docs/design/build/turborepo.md)).
