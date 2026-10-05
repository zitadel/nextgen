# CLI: Commands

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

The command surface under this model. Transcripts are illustrative, not a
committed surface.

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
deployed    dpl_01KB3F8N2P9S5WQY   3 deployment records written
```

`--origin` narrows this to one `primary` origin, for a project with several
production hostnames. It will not accept a `preview` origin.

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
origins     2 rows written, expire 2026-10-09T14:10:00Z
deployed    dpl_01KB3F8N2P9S5WQZ   2 deployment records written

NEXT_PUBLIC_ZITADEL_RELEASE=sha256:9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382
```

The last line is for the build that runs next, if it wants to
[pin](3-release-resolution.md#pinning-a-release); nothing is written to disk.

A preview URL is retired by the same verb that created it:

```
$ zitadel preview rm https://acme-git-sso-acmeinc.vercel.app
removed. the URL stops being served; its deployment records are kept.
```

Under `preview` rather than a command of its own because a preview URL is the
only kind the CLI can retire. A production hostname is taken out of service by
removing its allowlist pattern, since it
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
browser's `Origin` header. The allowlist binds them — a declared origin is
checked against the project's `preview` patterns at deploy time, so a preview
row can never exist for a URL the project does not allow. And since
[the row is what admits a request](2-origins.md#allowlist-and-preview-rows),
nothing else can either.

**Every URL the platform reports, not one.** A platform mints a branch-stable
URL and a per-deployment one, and it is the per-deployment one that its pull
request comment, its dashboard and its share links point at. A row for the
branch URL alone leaves the reviewer who clicked the platform's own link at
`403 proj.preview_not_live`. So the run registers both, with one expiry; a push
renews the branch row and adds the deployment row, and an abandoned branch's
rows expire together.

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

### `preview` must not be able to widen the allowlist

`zitadel preview` runs in a **pull-request** job, from a branch anyone with PR
access can write. Nothing in that branch reaches the allowlist: patterns are
project state, [not repository content](2-origins.md#why-the-allowlist-is-not-in-zitadeljson).
What a PR job does hold is a credential, and that is the part still to solve.

| | `zitadel deploy` | `zitadel preview` |
|---|---|---|
| Runs in | a pipeline job after merge, or by a person | a platform build or PR job, unreviewed branch |
| Allowlist patterns | read-only — `zitadel allowlist` is its own command | read-only |
| Project class | may change | may not |
| Variables | may set | may not — and sends none |
| Origin rows | `primary` | creates or renews `preview` rows, one per URL the platform reports |

So the first preview on a branch needing a brand-new pattern fails with
`proj.origin_not_allowed`, and the fix is for someone holding `project.write` to
add it — once, since one pattern covers every later branch.

**A division the CLI enforces is not a boundary.** The project secret carries
full operator authority, so a branch wanting to widen the allowlist would call
the endpoint directly rather than bother with the CLI. The table above is
therefore a convention until the server can express it, which needs **a
credential scoped to preview deploys and nothing else**: create or renew a
preview row for a URL matching a `preview` pattern, create a release, read the
allowlist, and no write to patterns, class, variables, `default` or
`primary`. ADR 036's `sk_team_` — "anything not listed under MAY is denied" —
is the shape to copy. See [Prerequisites](#prerequisites).

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

Exit code zero, no row written, no release built. `preview` does its work
when the resolved
[environment](5-cli-target-resolution.md#target-resolution) is `preview` —
Vercel's `preview`, Netlify's `deploy-preview` and `branch-deploy` — or
`development`, which is what a build with no signal and no `ZITADEL_ENV`
resolves to, and what a laptop with `--origin` resolves to. Any other name,
`production` or `staging` or whatever a branch was given, is a no-op that says
which name it saw. On Cloudflare, which has no signal, the production scope
therefore needs `ZITADEL_ENV=production`; without it a production build
holding a preview credential would register the production branch's own
preview URL — harmless, and visible in `zitadel deployments --live`, but the
one misconfiguration worth a warning in the output.

## `zitadel deployments`

Read-only, and the one view that covers every target the same way: the default,
each production hostname and each live preview URL. There is no `origins`
command, because a URL is not a thing the CLI manages — what exists is
deployments to it.

```
$ zitadel deployments --live
TARGET                                   SERVING          DEPLOYED      EXPIRES
(default)                                sha256:4a5b6c7d  10-02 09:30
https://app.acme.com                     sha256:4a5b6c7d  10-02 09:30
https://www.acme.com                     sha256:4a5b6c7d  10-02 09:30
https://acme-git-sso-acmeinc.vercel.app  sha256:9f2c1a7b  10-02 14:10   in 6d
https://acme-git-pw-acmeinc.vercel.app   sha256:81de4c7a  10-01 11:20   in 2d
```

`--live` is the newest row per target, which is
[what each one serves](1-data-model.md#why-there-is-no-pointer-column). An
`EXPIRES` column is filled only for a preview URL, because only a preview has a
row that expires. Bare, the command is the log itself, newest first:

```
$ zitadel deployments
DEPLOYED      TARGET                                   RELEASE          REASON    DEPLOY
10-02 14:10   https://acme-git-sso-acmeinc.vercel.app  sha256:9f2c1a7b  deploy    dpl_01KB…Y
10-02 09:30   (default)                                sha256:4a5b6c7d  rollback  dpl_01KB…W
10-02 09:30   https://app.acme.com                     sha256:4a5b6c7d  rollback  dpl_01KB…W
10-02 09:30   https://www.acme.com                     sha256:4a5b6c7d  rollback  dpl_01KB…W
10-01 17:02   (default)                                sha256:c3f7a8b2  deploy    dpl_01KB…V
```

One `DEPLOY` column repeated down three rows is one operation that moved three
targets, which is what `deploy_id` is for. `--origin <url>` narrows it to a
single target's history, and `--deploy <dpl_…>` to one operation's rows.

The allowlist is a separate command, because a pattern is project state rather
than release content and is changed deliberately rather than as a side effect of
shipping. Each line shows the check the pattern passed, which is what has to
stand in for the PR review the
[old design assumed](2-origins.md#why-the-allowlist-is-not-in-zitadeljson):

```
$ zitadel allowlist
PATTERN                           KIND
https://app.acme.com              primary
https://www.acme.com              primary
https://*-acmeinc.vercel.app      preview   bounded by label `-acmeinc` ✓
https://*.preview.acme.com        preview   domain verified ✓

$ zitadel allowlist add 'https://*--acme-site.netlify.app' --kind preview
checked   netlify.app  bounded by label `acme-site`  ✓
added     the preview credential may now register URLs matching it

$ zitadel allowlist add 'https://*.evil.com' --kind preview
error  origin_unbounded
       `*.evil.com` has no literal label on a shared host, so a leaked
       preview credential could register any URL under evil.com.

$ zitadel allowlist add 'https://*.acme.newhost.dev' --kind preview
warning  origin_host_unknown
         newhost.dev is not in the host list; the label could not be checked.
added
```

What the check protects is narrow and worth saying in the output: a pattern
admits no request, so the lint bounds a *leaked credential*, not a stranger —
[what a wildcard on a shared host is worth](2-origins.md#what-a-wildcard-on-a-shared-host-is-worth).

## `zitadel vars`

Variables and secrets, which are not process environment variables — `env` names
the client-side environment and `vars` the values a deployment serves. `set` and
`list` address [the store](4-variables.md#setting-one), `resolve --origin` reads
[what a target froze](4-variables.md#what-a-deployment-runs). Two commands
because they answer two questions, and conflating them is how "I set it and
nothing happened" happens.

`set --preview` stores the value a preview deploy prefers. That is the only
targeting the CLI offers, and no deploy command takes a variable flag of any
kind — [how a preview gets different values](4-variables.md#how-a-preview-gets-different-values).

```
$ zitadel vars rm GOOGLE_CLIENT_SECRET --preview
removed the preview value; previews now serve the production one.
2 deployments are still serving the removed value; they are unaffected.
```

Removing from the store never reaches a snapshot, which is the whole point of
[what a deployment runs](4-variables.md#what-a-deployment-runs) — and the reason
the message says so out loud rather than reporting a bare success.

## `zitadel rollback`

**The unit is the deploy, not the URL.** Bare, it undoes the last one — every
target that deploy moved, in a single operation:

```
$ zitadel rollback
undoing  dpl_01KB…Y   10-02 14:52   "add phone_number to human-user"

  (default)              sha256:9f2c1a7b -> sha256:4a5b6c7d
  https://app.acme.com   sha256:9f2c1a7b -> sha256:4a5b6c7d
  https://www.acme.com   sha256:9f2c1a7b -> sha256:4a5b6c7d

continue? [y/N] y
rolled back  dpl_01KB9X2M4P7S   3 deployment records written
```

Nobody is asked to repeat themselves per hostname. One deploy moved three
targets together under one `deploy_id`, so undoing it moves the same three back
together, in one transaction, under a new `deploy_id` of its own. Storage keeps
[a row per origin](1-data-model.md#why-not-one-row-holding-several-origins-or-a-group);
every command names the group.

`--to <dpl_…>` goes back further, re-applying what that deploy set on each
target it touched:

```
$ zitadel rollback --to dpl_01KB…V
  (default)              sha256:4a5b6c7d -> sha256:c3f7a8b2
  https://app.acme.com   sha256:4a5b6c7d -> sha256:c3f7a8b2
  https://www.acme.com   sha256:4a5b6c7d -> sha256:c3f7a8b2
```

A deploy rather than a release, because a release says nothing about which
targets were running it — the same digest may have gone to all three hostnames
or to one. `zitadel deployments` lists the deploys to pick from.

Three edges, each reported rather than guessed at:

- **A target the undone deploy created** has no earlier release, so it is left
  as it is and named in the output.
- **A target a later deploy has moved on** is not in the newest `deploy_id`, so
  bare `rollback` leaves it alone. `--to` is how you reach it.
- **`--origin <url>`** still narrows to one target, for the case where one
  hostname really is the whole intent. It is the exception, not the normal path.

Previews need none of this: `zitadel preview` writes only the URLs of its own
run and `deploy` never writes a preview row, so a deploy's target set is
already the production set.

Rolling back appends — a new row per target, `reason=rollback`, and the
`deploy_id` it reversed recorded on it — so rolling back and forward leaves a
trail that reads in both directions.

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
