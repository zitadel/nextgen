# Agent Instructions — `apps/docs`

The documentation site: Fumadocs on Next.js, laid out as Fumadocs' Next.js
template lays it out, in its Spacious layout. Reach for a Fumadocs recipe
before writing something of our own. Shared app rules:
[`apps/AGENTS.md`](../AGENTS.md).

## The look

The console's palette, faces and logo on Fumadocs' own components and
geometry.

- A colour is a `--zl-*` token, never a hex value: `app/global.css` fills
  Fumadocs' shadcn names from them. A missing one belongs in Figma
  ([`packages/design-tokens/AGENTS.md`](../../packages/design-tokens/AGENTS.md)).
- The theme switch sets both `class` (Fumadocs) and `data-theme` (the tokens)
  on `<html>` (`app/layout.tsx`).
- Fonts load through `next/font/local` from `app/fonts/`, so the build fetches
  nothing. APK Futural has one weight: never set a heading in it bold. The
  Arimo file is the website's; update both
  ([`apps/website/AGENTS.md`](../website/AGENTS.md#the-fonts)).
- Code uses the design system's syntax colours through Shiki's CSS-variables
  theme (`lib/code-theme.ts`).
- After a change to `app/global.css`, if `next dev` keeps the old stylesheet,
  delete `.next/dev` and restart.

## Everything under `/docs`

The cloud routes only `/docs` and `/docs/(.*)` to this app (repo-root
[`vercel.json`](../../vercel.json)), so the template's root routes (search,
MCP, `llms.txt`, Open Graph images, `.md` pages) live under `/docs` here.

- Put a new route under `app/docs/`, never at the app's root; `app/llms.mdx/`
  is the one exception, reached only through `proxy.ts`.
- A route under `app/docs/` that is not a page goes into the `matcher` of
  `proxy.ts` as an exclusion, or a request for Markdown gets a 404.
- Keep `assetPrefix`; never switch to `basePath`, or the URLs in `llms.txt`,
  the Markdown and the MCP answers lose their `/docs`.
- Link content by full path: `/docs/reference/cli`, not `/reference/cli`.
- The favicons are the cloud's, which the website serves at `/favicons/`
  ([`apps/website/AGENTS.md`](../website/AGENTS.md#the-logo-and-the-favicons)).
- `components/logo.tsx` copies `apps/website/app/logo.tsx` (its motion in
  `app/global.css`); change the copies together.
- Link the website (`/`) with a plain `<a>`, never `next/link`: it is another
  deployment, which `next/link` would prefetch and route to in this app.

## Content-Security-Policy

- `csp-adapter.mjs` enforces each prerendered page's script hashes, and the
  404's for other URLs in place of `next.config.mjs`' scriptless fallback.
- Never give a page a nonce or `'unsafe-inline'`: pages stay prerendered
  ([why](../../docs/design/cloud/csp-docs-and-website.md)).
- `csp-adapter.mjs` copies `apps/website/csp-adapter.mjs` but for the policy:
  change both. `next dev` keeps only the base policy for its runtime.
- Load nothing from another origin without widening the enforced policy
  in the same change; `tests/` fail on a violation or an unhashed script.

## Content

- Leave `index` out of a folder's `meta.json` `pages`: Fumadocs then opens it
  from the folder's own entry instead of listing it as a child that repeats the
  folder's name.
- A sidebar section (`components/sidebar.tsx`) is a folder with `root: true`
  and `pagesIndex: "index"`: a root folder has no index otherwise.
- When a page moves, add its old and new URL to `lib/moved.json`:
  `next.config.mjs` redirects it and its `.md` twin, and a test follows each.
- A page's URL is its path under `content/docs/`. The API reference pages per
  operation and per webhook come from the OpenAPI document (`lib/source.ts`);
  `moon run docs:generate` bundles it into `.generated/openapi.mjs`.
- An API tag's page is prose and `<Operations />`, its operations from that
  document; give its folder no `meta.json`, so the sidebar keeps their order.
- The CLI reference pages come from the CLI's `command-reference.json`
  (`lib/cli-reference.ts`), which the CLI's reference test writes: change the
  command, never the page ([`apps/cli/AGENTS.md`](../cli/AGENTS.md)). Its
  release notes come from the CLI's `CHANGELOG.md`: fix an entry there.
- The API reference's Errors page comes from the error schemas and each
  operation's error set (`lib/error-reference.ts`): change the server's errors,
  never the page ([`api/openapi/AGENTS.md`](../../api/openapi/AGENTS.md#error-codes)).
- An operation's description is its page body; its first sentence is the
  page's description everywhere else (`lib/description.ts`). The spec's side
  is in [`api/openapi/AGENTS.md`](../../api/openapi/AGENTS.md#descriptions--the-first-sentence-stands-alone).
- Render an operation or webhook page through `openapiPageProps`
  (`lib/source.ts`), never `getOpenAPIPageProps()` directly, which hands the
  client component the whole OpenAPI document.
- `llms-full.txt` leaves out operations and webhooks, and its test fails on a
  Markdown link to one: link prose to the section's page. Of the CLI's release
  notes it carries the newest version only.
- An operation's samples are its `@zitadel/api` call (`lib/sdk-sample.ts`),
  its `zitadel` command (`x-zitadel-cli`, `lib/cli-sample.ts`) and cURL
  (`components/api-page.tsx`); its Markdown repeats all three for the default
  request (`lib/source.ts`).
- `typecheck` compiles every sample against `@zitadel/api`
  (`scripts/sdk-samples.ts`). A new security scheme fails it until
  `lib/sdk-sample.ts` can authenticate with it.

## Live examples

The pages that document the login's components render them live, as
Fumadocs stories (`components/examples/`).

- A story's controls come from its component's prop types: give a control a
  prop, never a hand-written control.
- A `*.story.tsx` runs on the server: import only components and types from a
  client module, never a value (hence `flat-look.ts`).
- Run `<zitadel-login>` over the mock (`mock.ts`), never a server, and at most
  once per page: every login on a page walks the same mock flow.
- Never widen the mock's worker's scope beyond `/docs/`: on the cloud's host
  it would answer for the console.
- Keep the mock's request guard in `mock.ts`: only same-origin
  `/docs/mock-api/` calls may reach its handlers; worker scope limits pages, not requests.
- A page's Markdown leaves its examples out (`lib/source.ts`): write the prose
  around one so it reads without it.
- Type an atom an example renders in `elements.d.ts`, from the example's props.

## Page feedback

- `app/docs/api/feedback` posts ratings to the deployment's own URL, which
  deployment protection covers: keep the `cloud` project's automation bypass.
- Never send that route a valid rating from `tests/`: the suite runs against
  deployments, where it becomes a real event.

## Checks and tests

```sh
moon run docs:typecheck docs:lint docs:build
moon run docs:start   # the build on port 3003
moon run docs:e2e     # tests/ against the local build
CLOUD_URL=https://cloud-….vercel.app moon run docs:e2e-deployment
```

- Try the API playground on `moon run workspace:cloud`: it sends reads to its
  page's origin with the reader's session, and no API answers on the docs'
  port 3003.
- Vercel builds with `turbo run build --filter=@zitadel/docs`, never moon:
  moon cannot archive the symlinks Vercel's Next.js adapter writes into
  `.next/output`. The build's key holds the deployment's ID, so Vercel never
  restores it ([turborepo.md](../../docs/design/build/turborepo.md)).
- `tests/` is a contract suite written against a URL, so the same specs check
  the local build and any deployment. A deployment run needs
  `VERCEL_AUTOMATION_BYPASS_SECRET`.
- `pnpm check:cloud` runs the docs, console and schemas deployment suites, as
  [`deployment-checks.yml`](../../.github/workflows/deployment-checks.yml)
  does for every deployment
  ([runbook](../../docs/runbooks/cloud.md#checking-a-deployment-by-hand)).
- `/docs/llms.txt` is the suite's page list: every page in it is fetched as
  HTML and as Markdown, and its site links must resolve. A page needs no test
  of its own.
- A new non-page route gets a test in `tests/agents.spec.ts`.
- Against a deployment, record no traces and no HTML report: the repository is
  public, and both would hold the bypass secret
  ([runbook](../../docs/runbooks/cloud.md#deployment-checks)).
