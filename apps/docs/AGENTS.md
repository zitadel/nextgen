# Agent Instructions — `apps/docs`

The documentation site. Read together with the [root `AGENTS.md`](../../AGENTS.md)
and [`apps/AGENTS.md`](../AGENTS.md).

Fumadocs on Next.js, laid out as Fumadocs' Next.js template
(`create-fumadocs-app`) lays it out: `app/docs` serves `content/docs`,
`lib/source.ts` defines the collection with Fumadocs MDX's macro and loads it,
and the search, `llms.txt`, Markdown, Open Graph and MCP routes are Fumadocs'
own recipes. The look is Fumadocs' Spacious layout, the one fumadocs.dev uses,
without a theme of our own. Reach for a Fumadocs recipe before writing
something of our own.

## Everything under `/docs`

The hosted cloud routes only `/docs` and `/docs/(.*)` to this app; every other
path belongs to another service, `/_next/` to the website (repo-root
[`vercel.json`](../../vercel.json), [`apps/cloud/README.md`](../cloud/README.md)).
So the template's root routes live under `/docs` here:

| Route | Template |
| --- | --- |
| `/docs/api/search` | `/api/search` |
| `/docs/api/mcp` | `/api/mcp` (`fumadocs-core/mcp`) |
| `/docs/llms.txt`, `/docs/llms-full.txt` | `/llms.txt`, `/llms-full.txt` |
| `/docs/og/<page>/image.png` | `/og/docs/<page>/image.png` |
| `/docs/<page>.md`, the overview `/docs/index.md` | the same, through `proxy.ts` |

- A new route goes under `app/docs/`, never at the app's root. `app/llms.mdx/`
  is the one exception: only `proxy.ts` reaches it.
- A route under `app/docs/` that is not a page goes into the `matcher` of
  `proxy.ts` as an exclusion, or an agent asking for Markdown gets a 404.
- Scripts and styles load from `/docs/_next/` (`assetPrefix`). Do not switch to
  `basePath`: the URLs in `llms.txt`, the Markdown and the MCP answers would
  lose their `/docs`.
- A link in the content is the page's full path: `/docs/cli`, not `/cli`.
- The favicons are the one exception: `app/layout.tsx` links the cloud's, which
  the website serves at `/favicons/`
  ([`apps/website/AGENTS.md`](../website/AGENTS.md#the-logo-and-the-favicons)).

## Content

- A page's URL is its path under `content/docs/`. The API reference's own pages
  are in `content/docs/reference/api/`; a page per operation comes from the
  OpenAPI document (`lib/source.ts`).
- `moon run docs:generate` bundles `api/openapi` into `.generated/openapi.mjs`,
  which `lib/openapi.ts` imports. The content needs no generation step.
- A page's Markdown (`/docs/cli.md`, or `/docs/cli` with `Accept:
  text/markdown`) is its processed Markdown; an operation's is the operation
  with every schema it references (`docsLlms` in `lib/source.ts`).
  `llms-full.txt` leaves the operations out.

## Checks

`moon run docs:typecheck docs:lint docs:build`, and `moon run docs:start` to
look at the build on port 3003. On Vercel the build runs `pnpm run build`,
never moon: moon cannot archive the symlinks Vercel's Next.js adapter writes
into `.next/output`.

## Tests

`tests/` is the site's contract suite (Playwright, `playwright.config.mts`),
written against a URL rather than the code. `moon run docs:e2e` runs it
against the local build on port 3003; `DOCS_BASE_URL=https://cloud-….vercel.app
moon run docs:e2e-deployment` against a deployment of the hosted cloud, with
`VERCEL_AUTOMATION_BYPASS_SECRET` for its protection, which
[`deployment-checks.yml`](../../.github/workflows/deployment-checks.yml) does for every
deployment. The specs use paths only, so one spec proves both.

- `/docs/llms.txt` is the suite's page list: every page it names is fetched as
  HTML, at its `.md` URL and through `Accept: text/markdown`, and every site
  link in the Markdown must resolve. A page needs no test of its own.
- The routes that are not pages each have a test in `tests/agents.spec.ts`:
  search, the MCP server (`initialize`, `tools/list`, `get_page`), the
  plain-text answers, the Open Graph image. A new route under `app/docs/` gets
  one there, and goes into the matcher of `proxy.ts` (above).
- `tests/pages.spec.ts` also pins the assets to `/docs/_next/` and
  `llms-full.txt` to the pages without the API operations.
- One browser test (`*.browser.spec.ts`, Chromium) proves the site hydrates
  and navigates; everything else is HTTP through Playwright's request fixture.
- Against a deployment, no traces and no HTML report, and the workflow uploads
  the screenshots alone: the repository is public, and a trace or the error of
  a failed request holds the bypass secret
  ([`docs/runbooks/cloud.md`](../../docs/runbooks/cloud.md#deployment-checks)).
