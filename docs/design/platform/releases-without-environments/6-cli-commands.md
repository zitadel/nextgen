# CLI: Commands

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

The command surface under this model. Transcripts are illustrative, not a
committed surface.

The grammar is `zitadel <noun> <verb>`, with the noun singular: `deployment
list`, `origin add`, `variable set`, `release revoke`, `preview rm`, `env add`.
`add` puts something on a list, `set` is a key and a value, `rm` removes.
`deploy` and `preview` are the two bare verbs, because a pipeline types them.

## `zitadel deploy`

```
$ zitadel deploy -m "add phone_number to human-user"
building    3 changed resources
release     sha256:9f2c1a7b  (new)

deploying to 3 targets
  (default)                 sha256:4a5b6c7d -> sha256:9f2c1a7b
  https://app.acme.com      sha256:4a5b6c7d -> sha256:9f2c1a7b
  https://www.acme.com      sha256:4a5b6c7d -> sha256:9f2c1a7b

  removes: idps/okta   (present in the current release, absent locally)

continue? [y/N] y
deployed    dep_01KB3F8N2P9S5WQY   3 targets
```

`--origin` narrows this to one `primary` origin, for a project with several
primary hostnames. It will not accept a `preview` origin.

**The release is built from file content, by the server.** `deploy` sends the
contents of `.zitadel/` — schemas, flow definitions, branding — as the `bundle`
of one `POST /releases`. The server compares each resource against the
project's newest revision of the same handle, reuses it when the content
matches, allocates a revision otherwise, and answers with the release and the
revisions it pinned; a bundle the project has already released answers `200`
with that release. The same call takes `pointers` instead of a `bundle` for a
release pinned by revision ids, which is what a console-made release sends.
Nothing on the client records revision ids, so the same directory builds the
same release on any project.

## `zitadel preview`

Its own verb, not `deploy --origin`, because `deploy` and `deploy --origin` differ
enormously in blast radius and distinguishing them by the presence of a flag puts
shipping to production one forgotten flag away.

| Verb | May target | Sets a TTL |
|---|---|---|
| `zitadel deploy` | the project default and `primary` origins | no |
| `zitadel preview` | `preview` origins only | yes, renewed on each run |

The verb and the origin kind must agree: `deploy --origin <preview-url>` is
refused, and so is `preview --origin https://app.acme.com`.

```
$ zitadel preview
platform    vercel
origins     https://acme-git-sso-acmeinc.vercel.app   VERCEL_BRANCH_URL
            https://acme-k3x9v2-acmeinc.vercel.app    VERCEL_URL
            both match https://*-acmeinc.vercel.app (preview)  ✓

building    3 changed resources
release     sha256:9f2c1a7b  (exists, reusing)
previews    2 written, expire 2026-10-09T14:10:00Z
deployed    dep_01KB3F8N2P9S5WQZ   2 targets

NEXT_PUBLIC_ZITADEL_RELEASE=sha256:9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382
```

The last line is for the build that runs next, if it wants to
[pin](3-release-resolution.md#pinning-a-release); nothing is written to disk.

The live previews are listed and retired under the same noun:

```
$ zitadel preview list
URL                                       EXPIRES   CREATED
https://acme-git-sso-acmeinc.vercel.app   in 6d     10-02 14:10
https://acme-k3x9v2-acmeinc.vercel.app    in 6d     10-02 14:10

$ zitadel preview rm https://acme-git-sso-acmeinc.vercel.app
removed. the URL stops being served; its deployment targets are kept.
```

Under `preview` rather than a noun of its own because a preview URL is the
only kind the CLI can retire. A primary hostname is taken out of service by
removing its origin pattern, since it
[has no row to delete](1-data-model.md#why-a-primary-hostname-has-no-row).

**The CLI resolves the origin locally and then sends it.** It is explicit data in
the deploy request; the server never derives it from the connection the request
arrived on, which in CI is a runner talking to `api.zitadel.cloud` and says
nothing about the preview URL.

```http
POST /deployments HTTP/1.1
Authorization: Bearer sk_proj_9f2Hx8LqT4vRmYpN2wCbVa

{
  "release": "sha256:9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382",
  "targets": [
    "https://acme-git-sso-acmeinc.vercel.app",
    "https://acme-k3x9v2-acmeinc.vercel.app"
  ],
  "reason":  "deploy",
  "ttl":     "7d"
}
```

The same strings therefore arrive by two routes: **declared** at deploy time,
backed by the preview credential, and **attested** at request time by the
browser's `Origin` header. The origins bind them — a declared URL is checked
against the project's `preview` patterns at deploy time, so a preview can never
exist for a URL the project does not allow. And since
[the preview is what admits a request](2-origins.md#origins-and-previews),
nothing else can either.

**Every URL the platform reports, not one.** A platform mints a branch-stable
URL and a per-deployment one, and it is the per-deployment one that its pull
request comment, its dashboard and its share links point at. A preview for the
branch URL alone leaves the reviewer who clicked the platform's own link at
`403 proj.preview_not_live`. So the run registers both, with one expiry; a push
renews the branch preview and adds the deployment's, and an abandoned branch's
previews expire together.

Origin resolution, highest priority first:

1. `--origin <url>`, repeatable
2. What the platform reports for this build:

   | Platform | Branch-stable | Per-deployment | Notes |
   |---|---|---|---|
   | Vercel | `VERCEL_BRANCH_URL` | `VERCEL_URL` | bare hostnames; the CLI prepends `https://`. Present only when the project exposes system environment variables, which is the default |
   | Netlify | `DEPLOY_PRIME_URL` | `DEPLOY_URL` | full URLs |
   | Cloudflare Pages | `https://<branch>.<project>.pages.dev`, built from `CF_PAGES_BRANCH` with the platform's own label sanitising | `CF_PAGES_URL` | the branch alias is not exported; the CLI constructs it |
   | Cloudflare Workers Builds | — | — | no URL is exported to the build; `--origin` is required |

3. Error naming the variables it looked for

Outside a platform build there is no preview URL to infer:

```
$ zitadel preview
error  no preview URL found
       looked for: VERCEL_BRANCH_URL, DEPLOY_PRIME_URL, CF_PAGES_BRANCH

       `zitadel preview` runs in a deploy pipeline, where the platform
       publishes the URL. Local work needs no preview URL at all.
       To target a URL explicitly: zitadel preview --origin <url>
```

**A build with no credential does not fail.** Vercel and Netlify withhold
secrets from a deployment built from a fork, so a pull request from outside
the repository runs the build with `ZITADEL_PREVIEW_TOKEN` unset. Failing there
would fail the whole deployment over a login the reviewer may not need.
Instead:

```
$ zitadel preview
warning  no preview credential in the environment — skipping
         the app will build; sign-in on this preview will answer
         403 proj.preview_not_live until a credential is present
```

Exit code zero. `--strict` turns the warning into a failure for pipelines that
would rather know.

### `preview` must not be able to widen the origins

`zitadel preview` runs in a **pull-request** job, from a branch anyone with PR
access can write. Nothing in that branch reaches the origins: patterns are
project state, [not repository content](2-origins.md#why-the-origins-are-not-in-zitadeljson).
What a PR job does hold is a credential, and that is the part still to solve.

| | `zitadel deploy` | `zitadel preview` |
|---|---|---|
| Runs in | a pipeline job after merge, or by a person | a platform build or PR job, unreviewed branch |
| Origin patterns | read-only — `zitadel origin` is its own noun | read-only |
| Project mode | may change | may not |
| Variables | may set | may not — and sends none |
| Targets | the default and `primary` origins | preview URLs only; creates or renews a preview per URL the platform reports |

So the first preview on a branch needing a brand-new pattern fails with
`proj.origin_not_allowed`, and the fix is for someone holding `project.write` to
add it — once, since one pattern covers every later branch.

**A division the CLI enforces is not a boundary.** The project secret carries
full operator authority, so a branch wanting to widen the origins would call
the endpoint directly rather than bother with the CLI. The table above is
therefore a convention until the server can express it, which needs **a
credential scoped to preview deploys and nothing else**: create or renew a
preview for a URL matching a `preview` pattern, create a release, read the
origins, and no write to patterns, mode, variables, `default` or `primary`.
ADR 036's `sk_team_` — "anything not listed under MAY is denied" — is the shape
to copy. See [Prerequisites](#prerequisites).

This matters more on a platform than in a hand-written pipeline. A platform
build runs with whatever the environment store holds for that scope, and the
scope is the only thing separating a production build from a preview build.
Hold only the preview credential there, in the preview scope, and a build
*cannot* move production whichever command it runs.

### Only `preview` runs in a platform build

Vercel and Cloudflare Pages run one build command for every environment, and
that command is where `zitadel preview` has to run, since the platform's URL
variables exist only inside its build. The same string also runs for the
production branch. Rather than make the command dispatch on the environment —
`[ "$VERCEL_ENV" = production ] && zitadel deploy || zitadel preview` is the
one-forgotten-condition risk the two verbs exist to remove — the rule is that
**`zitadel deploy` never runs in a platform build**. It runs after merge, in a
pipeline job or by a person, with the project secret, which therefore never
has to be placed in the platform's environment store at all.

So the build command is `zitadel preview && next build` on every branch, and
`preview` knows when it is in a production build:

```
$ zitadel preview
environment  production   VERCEL_ENV
nothing to preview — production is deployed by `zitadel deploy`, after merge
```

Exit code zero, no preview written, no release built. `preview` does its work
when the resolved
[environment](5-cli-environment-resolution.md#environment-resolution) is `preview` —
Vercel's `preview`, Netlify's `deploy-preview` and `branch-deploy` — or
`development`, which is what a build with no signal and no `ZITADEL_ENV`
resolves to, and what a laptop with `--origin` resolves to. Any other name,
`production` or `staging` or whatever a branch was given, is a no-op that says
which name it saw. On Cloudflare, which has no signal, the production scope
therefore needs `ZITADEL_ENV=production`; without it a production build
holding a preview credential would register the production branch's own
preview URL — harmless, and visible in `zitadel deployment list --live`, but
the one misconfiguration worth a warning in the output.

## `zitadel deployment`

Read-only listing, plus `rollback`. `list` is the one view that covers every
target the same way: the default, each primary hostname and each live preview
URL.

```
$ zitadel deployment list --live
TARGET                                   SERVING          DEPLOYED      DEPLOYMENT    EXPIRES
(default)                                sha256:4a5b6c7d  10-02 09:30   dep_01KB…W
https://app.acme.com                     sha256:4a5b6c7d  10-02 09:30   dep_01KB…W
https://www.acme.com                     sha256:4a5b6c7d  10-02 09:30   dep_01KB…W
https://acme-git-sso-acmeinc.vercel.app  sha256:9f2c1a7b  10-02 14:10   dep_01KB…Y    in 6d
https://acme-git-pw-acmeinc.vercel.app   sha256:81de4c7a  10-01 11:20   dep_01KB…U    in 2d
```

`--live` is the newest target row per origin, which is
[what each one serves](1-data-model.md#why-there-is-no-pointer-column). An
`EXPIRES` column is filled only for a preview URL, because only a preview
expires. Bare, the command is the log itself, one line per deployment, newest
first:

```
$ zitadel deployment list
DEPLOYED      TARGETS                                       RELEASE          REASON    DEPLOYMENT
10-02 14:10   https://acme-git-sso-acmeinc.vercel.app, +1   sha256:9f2c1a7b  deploy    dep_01KB…Y
10-02 09:30   (default), https://app.acme.com, +1           sha256:4a5b6c7d  rollback  dep_01KB…W
10-01 17:02   (default), https://app.acme.com, +1           sha256:c3f7a8b2  deploy    dep_01KB…V
```

One line is one operation, however many targets it moved. `--origin <url>`
narrows it to the deployments that touched a single target, and
`zitadel deployment get dep_…` shows one with every target spelled out.

The origins are a separate noun, because a pattern is project state rather
than release content and is changed deliberately rather than as a side effect
of shipping. Each line shows the check the pattern passed, which is what has to
stand in for the PR review the
[old design assumed](2-origins.md#why-the-origins-are-not-in-zitadeljson):

```
$ zitadel origin list
PATTERN                           KIND
https://app.acme.com              primary
https://www.acme.com              primary
https://*-acmeinc.vercel.app      preview   bounded by label `-acmeinc` ✓
https://*.preview.acme.com        preview   domain verified ✓

$ zitadel origin add 'https://*--acme-site.netlify.app' --kind preview
checked   netlify.app  bounded by label `acme-site`  ✓
added     the preview credential may now register URLs matching it

$ zitadel origin add 'https://*.evil.com' --kind preview
error  origin_unbounded
       `*.evil.com` has no literal label on a shared host, so a leaked
       preview credential could register any URL under evil.com.

$ zitadel origin add 'https://*.acme.newhost.dev' --kind preview
warning  origin_host_unknown
         newhost.dev is not in the host list; the label could not be checked.
added
```

What the check protects is narrow and worth saying in the output: a pattern
admits no request, so the lint bounds a *leaked credential*, not a stranger —
[what a wildcard on a shared host is worth](2-origins.md#what-a-wildcard-on-a-shared-host-is-worth).

## `zitadel variable`

Variables and secrets, which are not process environment variables — `env`
names the client-side environment and `variable` the values a deployment
serves. `set` and `list` address [the store](4-variables.md#setting-one),
`resolve --origin` reads [what a target froze](4-variables.md#what-a-deployment-runs).
Two commands because they answer two questions, and conflating them is how "I
set it and nothing happened" happens.

`set --preview` stores the value a preview deploy prefers. That is the only
targeting the CLI offers, and no deploy command takes a variable flag of any
kind — [how a preview gets different values](4-variables.md#how-a-preview-gets-different-values).

```
$ zitadel variable rm GOOGLE_CLIENT_SECRET --preview
removed the preview value; previews now serve the production one.
2 deployments are still serving the removed value; they are unaffected.
```

Removing from the store never reaches a snapshot, which is the whole point of
[what a deployment runs](4-variables.md#what-a-deployment-runs) — and the reason
the message says so out loud rather than reporting a bare success.

## `zitadel release`

`list` and `get` read the releases a project holds; `revoke` is the operator's
hard stop from the [data model](1-data-model.md#release). Releases are built
by `deploy`, `preview` and `setup`, never by a command of their own.

## `zitadel deployment rollback`

**The unit is the deployment, not the URL.** Bare, it undoes the last one —
every target that deployment moved, in a single operation:

```
$ zitadel deployment rollback
undoing  dep_01KB…Y   10-02 14:52   "add phone_number to human-user"

  (default)              sha256:9f2c1a7b -> sha256:4a5b6c7d
  https://app.acme.com   sha256:9f2c1a7b -> sha256:4a5b6c7d
  https://www.acme.com   sha256:9f2c1a7b -> sha256:4a5b6c7d

continue? [y/N] y
rolled back  dep_01KB9X2M4P7S   3 targets
```

Nobody is asked to repeat themselves per hostname. One deployment moved three
targets together, so undoing it moves the same three back together, in one
transaction, as a new deployment of its own. Storage keeps
[a target row per origin](1-data-model.md#why-not-one-row-holding-several-origins-or-a-group);
every command names the deployment.

A deployment id goes back further, re-applying what that deployment set on
each target it touched:

```
$ zitadel deployment rollback dep_01KB…V
  (default)              sha256:4a5b6c7d -> sha256:c3f7a8b2
  https://app.acme.com   sha256:4a5b6c7d -> sha256:c3f7a8b2
  https://www.acme.com   sha256:4a5b6c7d -> sha256:c3f7a8b2
```

A deployment rather than a release, because a release says nothing about which
targets were running it — the same digest may have gone to all three hostnames
or to one. `zitadel deployment list` lists the deployments to pick from.

Three edges, each reported rather than guessed at:

- **A target the undone deployment created** has no earlier release, so it is
  left as it is and named in the output.
- **A target a later deployment has moved on** is not in the newest
  deployment, so bare `rollback` leaves it alone. Naming the deployment is how
  you reach it.
- **`--origin <url>`** still narrows to one target, for the case where one
  hostname really is the whole intent. It is the exception, not the normal path.

Previews need none of this: `zitadel preview` writes only the URLs of its own
run and `deploy` never writes a preview, so a deploy's target set is already
the primary set.

Rolling back appends — a new deployment with a target row per origin,
`reason=rollback`, and the deployment it reversed recorded as `rollback_of` —
so rolling back and forward leaves a trail that reads in both directions.

## `zitadel env`

Bare, it prints what resolved and from where. `list` and `add` manage the
bindings themselves, and the transcripts for those are under
[environments](7-cli-environments.md#environments-pointing-one-repository-at-several-projects).

```
$ zitadel env
environment  production          VERCEL_ENV
server       https://api.zit…    ZITADEL_URL (process env)
project      prj_01K9AA9M3K…     .env.production.local
token        sk_proj_9f2H…       process env
release      sha256:9f2c1a7b     (built from working copy, not yet deployed)

consulted, in order:
  --server flag                 (not set)
  --env-file                    (not set)
  process env                   server, token
  .env.production.local         project
  .env.local                    (not present)
  .env.production               (no relevant keys)
  .env                          (no relevant keys)
  zitadel.json                  (superseded)
  .zitadel/secret               (superseded)
```

## Prerequisites

**A preview-deploy credential**, narrower than the project secret, or the
`deploy`/`preview` trust division on this page stays advisory rather than
enforced. It has to land before `zitadel preview` does, not after: on a
platform the credential in the preview scope is the whole boundary, and a
project secret there is the full operator authority sitting in every pull
request build.
