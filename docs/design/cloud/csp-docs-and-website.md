# Inline scripts under the docs' and the website's Content-Security-Policy

> **Status:** decided, 2026-10-29: enforced hashes, the 404's for unknown URLs.
> Next.js 16.4.1 on Vercel (project `cloud`), after zitadel/nextgen#2480. Each app's
> `csp-adapter.mjs` implements it.
> **Question:** how can the docs (`apps/docs`) and the website
> (`apps/website`) stop allowing inline script, and what does each way cost?

## Short answer

Use **hashes, computed per page at build time by a Next.js build adapter**.
The pages stay prerendered and the CDN serves each one with a policy that
lists its own inline scripts' hashes. That adds nothing at runtime and 0.34 s
to the docs' build. A prototype on Vercel covered every prerendered docs
page.

- **Nonces** cost little money (about $20 a month) but render every page per
  request. 99% of those renders would be our own deployment checks. A
  visitor waits 50–400 ms longer on a warm instance and about 5 s on a cold
  docs one. They also don't work on Vercel as #2480's first commit wired them:
  Next.js never finds the nonce.
- **`experimental.sri`** covers no inline script at all.
- **Staying as is** costs nothing, and inline script stays unchecked.

## What the pages run inline

Every App Router page inlines Next.js' bootstrap: the Turbopack chunk list,
`(self.__next_f=self.__next_f||[]).push([0])` and the RSC payload as
`self.__next_f.push([1,"…"])`. Next.js has no option to load these from a
file. Then come the theme scripts (next-themes in the docs, `THEME_SCRIPT` on
the website), and on one docs page React's Suspense reveal scripts.

| | Pages | Inline scripts per page | Their hashes in a policy |
| --- | --- | --- | --- |
| docs | 277 | 3–9, median 5 | 161–485 bytes, median 269 |
| website | 46 | 3–4 | 161–215 bytes |

Between two builds of the same commit, only the build ID inside the RSC
payload changed. So each build needs its own hashes, taken from the HTML it
ships.

## Nonces

The prototype (branch `claude/csp-nonce-cost`) is #2480's first commit on
top of its current policies. The proxy gives each page a nonce, and the
layouts pass it to next-themes and to `THEME_SCRIPT`. Every docs page and
the website's `/` then render per request. The changelog stays prerendered
(`force-static`), and so does Markdown for agents.

### Latency

Server wait: time to first byte minus the TLS handshake. Measured from San
Francisco against previews in `sfo1`, as medians of 8–12 requests.

| Page | Static, CDN hit | Nonce, warm | Nonce, cold |
| --- | --- | --- | --- |
| docs content (`/docs/concepts/flows-and-schemas`) | 36 ms | 93 ms | ≈5 s |
| docs API operation (`…/api/users/createUser`) | 37 ms | 117 ms | 5.0 s |
| docs API errors (`/docs/reference/api/errors`) | 41 ms | 411 ms | ≈5 s + render |
| website `/` | 22 ms | 74 ms | 1.7 s |

The cold column is one request after 25 idle minutes, which found a cold
instance in both measured rows. The same requests on the static preview
took 81 ms and 33 ms. The rows marked ≈ take the measured cold start and
the page's own render. Of the 5.0 s, the function took 4.1 s; on the
website, 0.7 s of 1.7 s.

Across all fresh docs instances (`functionStartType` `cold` or
`prewarmed`), the function took p50 4.1 s and up to 5.3 s, of which 3.5 s is
CPU spent loading the docs' server bundle. Prewarmed instances were no
faster on their first page (3.6 s).

Real visitors would meet cold instances often. The custom domain gets about
26 docs page requests an hour, spread over five function regions. Over the
last 7 days, 56% of the invocations of production's `/docs/api/search`
started on a fresh instance (136 cold, 129 prewarmed, 206 hot).

### Render cost per page (Vercel metrics, warm)

| Page | Active CPU avg / p50 / p90 | Locally (M-series) |
| --- | --- | --- |
| docs content | 57 / 40 / 110 ms | 8 ms |
| docs API operation | 86 / 80 / 150 ms | 13 ms |
| docs API errors | 399 / 350 / 510 ms | 80 ms |
| website `/` | 28 / 30 / 40 ms | 6 ms |

Each instance has 2 GB provisioned and peaked at 552 MB. A render sends
42 KB (docs) or 33 KB (`/`) of Fast Origin Transfer.

### Monthly change

Traffic is `vercel.request.count` by route over the 14 days from 2026-10-15
to 10-28, scaled to 30 days. The docs went live on 10-11, and weekdays reach
110,000 page requests.

| | Requests per month | Who |
| --- | --- | --- |
| docs pages, previews | 1,580,000 | deployment checks: about 560 pages per deployment |
| docs pages, production | 294,000 | 96% deployment checks against each production deployment's own URL (63 deployments on 10-27 and 10-28); about 19,000 on preview.zitadel.com, 2/3 of them bots |
| website `/` | about 5,000 | |

One run of the docs' deployment checks against the nonce preview took 564
renders and 80 s of Active CPU, 141 ms per render including its 14 fresh
instances. At that mix, per month:

| Resource | Usage | Cost (iad1 prices) |
| --- | --- | --- |
| Invocations | +1.9 M | $1.10 |
| Active CPU | +73 h | $9.40 (up to $13.50 in fra1) |
| Provisioned memory | ≤ 163 GB-h | ≤ $1.70 |
| Fast Origin Transfer | +79 GB | $4.70 |
| **Total** | | **about $17–21** |

The docs' proxy already runs on every page today: in production alone, about
900,000 middleware invocations a month at 12.6 ms of CPU each. That's
unchanged either way.

### Nonces don't reach Next.js on Vercel

Next.js reads the nonce from the request's `content-security-policy` header
and falls back to `-report-only` only when that header is missing
(`parse-request-headers.js`). On Vercel, `next.config`'s `headers()` land on
the request as well. The enforced policy, which has no `script-src`, therefore
hides the proxy's nonce. On both nonce previews, 23 of a docs page's 24
scripts carried no nonce; only the layout's theme script did. That held even
after the proxy set the request's `content-security-policy` itself. The
earlier gotcha (move the enforced policy to `next.config`) is right for
`next start` and wrong for Vercel. Locally every script had the nonce.

A nonce rollout on Vercel would have to drop the enforced header from pages
while it reports, or enforce the nonce policy right away. Neither was tried.

### The changelog

The changelog reads the repository at build time, so no request can give it
a nonce. Rendering it per request would mean generating its data into a
module at build time first. With hashes it needs nothing: it is prerendered
like the rest.

## Hashes

### `experimental.sri`

Built with Turbopack, it added `integrity` to 6 of a page's 20 external
scripts and left every inline script as it was. Next's CSP guide pairs it
with `script-src 'self'`, which would block every page's bootstrap. It
doesn't help here.

### A build adapter

The policy must name hashes that exist only after prerendering, so it can't
be computed in `next.config` or the proxy, which are both built earlier. A
Next.js build adapter (`adapterPath`, stable in 16) runs after prerendering
and receives each prerendered page's HTML file and `initialHeaders`. Vercel
passes its own adapter in `NEXT_ADAPTER_PATH`, so ours can wrap it:

1. For each prerender whose file is HTML, hash its inline scripts and add
   the policy to `fallback.initialHeaders`.
2. Hand the outputs to Vercel's adapter (`modifyConfig` and
   `onBuildComplete`).

The prototype (branch `claude/csp-hash-adapter`, `apps/docs/csp-adapter.mjs`,
about 70 lines) sends the hashes in the report-only policy. On its preview:

- The build logged `onBuildComplete from csp hashes + Vercel`, with 276
  pages hashed in 0.34 s.
- On 274 of the 274 pages in `llms.txt`, every inline script's hash was in
  the page's served policy, and the CDN served the pages as before (`HIT` or
  `PRERENDER`, 36–41 ms).
- The docs' browser tests saw no inline-script violation, client-side
  navigation and the live examples' service worker included. Their only
  violation was Vercel's toolbar (`vercel.live`), which #2480 now allows.

### Enforcement and the fallback

The adapters append one `Content-Security-Policy` header rule per
prerendered page, to the platform's routing and `next start`'s build manifest.
These rules override the earlier fallback. A policy in `initialHeaders` or
`.meta` appends a second header on `next start`, so a restrictive fallback
there would also block the hashed scripts. `next.config` supplies a restrictive
fallback for responses without a prerendered policy: `script-src 'none'`,
same-origin styles with style attributes, images, fonts and connections,
and no framing. `next dev` retains only the base policy because it has no
prerender hashes and needs its development runtime.

Every unknown URL answers with the same prerendered 404 (`dynamicParams =
false` sends an unknown docs slug there, inside the docs layout). Next writes
it as a static `pages/404.html` whose inline scripts the build fixes, so the
adapter hashes them like any page's and puts that policy in place of the
fallback. The 404 hydrates: the layout's search, sidebar and theme work, Web
Analytics counts it, and its scripts send no violation reports. A 404
rendered on demand would carry scripts no policy lists, and Next's can need
one just to reveal its content. If the build writes no static 404, the
scriptless fallback stays and the 404 browser checks fail.

The fallback also reaches responses that are not HTML. For a service worker
it is the worker's own policy: the docs' live examples run MSW's worker, which
`fetch()`es every request it does not mock, so its script gets only the base
policy.

The URL-based checks inspect the **enforced** policy, including every
inline script's hash, and browser checks verify hydration, navigation,
inline-script blocking and both 404s. The same suites run against a
Vercel deployment to catch routing/header precedence differences.

Keep `https://vercel.live` for the toolbar. The adapter still wraps
`NEXT_ADAPTER_PATH`; if Vercel changes that seam, the deployment checks
must catch a missing or overridden hash policy.

## Staying as is

The report-only `'unsafe-inline'` policy costs nothing and limits where
requests and images go, once enforced. It doesn't stop an injected inline
script, which on this origin acts with a signed-in user's session. The
docs' and website's content comes from the repository, rendered by React,
so the known injection surface is small. CSP would be the backstop for the
next bug.

## Recommendation

1. Add the adapter to the docs and the website, report-only, keeping
   `https://vercel.live`. Done in the initial rollout; enforcement now uses
   header rules so the fallback and the page policy cannot intersect.
2. Assert, on every deployment, that every inline script carries a hash in
   its page's policy: the docs' `tests/` for every docs page, the cloud's
   `e2e/console/src-deployment/routes.spec.ts` for the website's. Done.
3. Enforce the hash policy, and give every URL without a page of its own the
   prerendered 404's, scriptless if the build wrote none. Validate both
   against the local build and the deployed artifact.

## How it was measured

- Previews:
  - `dpl_4WnuCsBTTq3DvFwzeukZJvdAM226`: static, #2480's head.
  - `dpl_J6JVGw7K6qF3gQCEb9qRvaX33V4y` and `dpl_ExsBtmTMJtzpvWudLyxjdQPBSYxd`:
    nonces, before and after the request-header attempt.
  - `dpl_z31ainVaXSzChDBFKYZ1zF64D6bf`: hashes.
- Latency: `curl` with the automation bypass and `x-vercel-skip-toolbar`,
  `time_starttransfer − time_appconnect`.
- Render cost: `vercel metrics vercel.function_invocation.{function_cpu_time_ms,function_duration_ms,count}`,
  grouped by `requestPath` and `functionStartType`.
- Traffic: `vercel metrics vercel.request.count` by route, environment and
  day; `vercel logs requests` for two days of production, split by host and
  user agent. Web Analytics shows only 755 docs page views in 30 days, since
  it counts only browsers that run its script.
- Prices: Vercel's Fluid compute and iad1 price pages, 2026-10-29.
