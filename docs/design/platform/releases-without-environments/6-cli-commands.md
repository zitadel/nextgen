# CLI: Commands

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

The command surface under this model. Transcripts are illustrative, not a
committed surface.

## `zitadel status`

```
$ zitadel status
server   https://api.zitadel.cloud          (ZITADEL_URL)
project  prj_01K9AA9M3K7E2QX8VB4T  acme     (.zitadel/secret)
class    production

local    sha256:9f2c1a7b  (3 files changed since the last release)

TARGET                                  SERVING          DEPLOYED      EXPIRES
(default)                               sha256:4a5b6c7d  10-02 09:30
https://app.acme.com                    sha256:4a5b6c7d  10-02 09:30
https://www.acme.com                    sha256:4a5b6c7d  10-02 09:30
https://acme-git-sso-acmeinc.vercel.app sha256:9f2c1a7b  10-02 14:10   in 6d

  local differs from (default) — run `zitadel deploy` to ship it
```

Drift is one comparison: hash the working copy, compare to what each target
serves.

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
deployed    dpl_01KB3F8N2P9S5WQY   4 deployment records written
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
platform    vercel  (VERCEL_BRANCH_URL)
origin      https://acme-git-sso-acmeinc.vercel.app
            matches https://*-acmeinc.vercel.app (preview)  ✓

building    3 changed resources
release     sha256:9f2c1a7b  (exists, reusing)
origin      created, expires 2026-10-09T14:10:00Z
deployed    dep_01KB3F8N2P9S5WQZ
```

**The CLI resolves the origin locally and then sends it.** It is explicit data in
the deploy request; the server never derives it from the connection the request
arrived on, which in CI is a runner talking to `api.zitadel.cloud` and says
nothing about the preview URL.

```http
POST /deployments HTTP/1.1
Authorization: Bearer sk_proj_9f2Hx8LqT4vRmYpN2wCbVa

{
  "release": "sha256:9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382",
  "targets": ["https://acme-git-sso-acmeinc.vercel.app"],
  "reason":  "deploy",
  "ttl":     "7d"
}
```

The same string therefore arrives by two routes: **declared** at deploy time,
backed by the project secret, and **attested** at request time by the browser's
`Origin` header. The allowlist binds them — a declared origin is checked against
the project's patterns at deploy time, so an origin row can never exist for an
origin the project does not permit.

Origin resolution, highest priority first:

1. `--origin <url>`
2. The platform's **branch-stable** URL — `VERCEL_BRANCH_URL`,
   `DEPLOY_PRIME_URL`, `CF_PAGES_URL`
3. Error naming the variables it looked for

Branch-stable, not per-deployment: `VERCEL_URL` and `DEPLOY_URL` change on every
push, which would write one origin row per push and leave the reviewer's link
pointing at a row nothing renews.

Re-running on the next push renews `expires_at` and moves that origin's pointer,
so the preview URL is stable across pushes and an abandoned branch's origin
expires and is collected.

Outside CI there is no preview URL to infer:

```
$ zitadel preview
error  no preview URL found
       looked for: VERCEL_BRANCH_URL, DEPLOY_PRIME_URL, CF_PAGES_URL

       `zitadel preview` runs in a deploy pipeline, where the platform
       publishes the URL. For local work use `zitadel dev`.
       To target a URL explicitly: zitadel preview --origin <url>
```

### `preview` must not be able to widen the allowlist

`zitadel preview` runs in a **pull-request** job, from a branch anyone with PR
access can write. Nothing in that branch reaches the allowlist: patterns are
project state, [not repository content](2-origins.md#why-the-allowlist-is-not-in-zitadeljson),
so committing `https://*.evil.com` grants nothing. What a PR job does hold is a
credential, and that is the part still to solve.

| | `zitadel deploy` | `zitadel preview` |
|---|---|---|
| Runs in | the production job, after merge | a PR job, unreviewed branch |
| Allowlist patterns | read-only — `zitadel allowlist` is its own command | read-only |
| Project class | may change | may not |
| Variables | may set | may not |
| Origin rows | `primary` | creates or renews one `preview` row |

So the first preview on a branch needing a brand-new pattern fails with
`proj.origin_not_allowed`, and the fix is for someone holding `project.write` to
add it — once, since one pattern covers every later branch.

**A division the CLI enforces is not a boundary.** A PR job needs a credential to
deploy, and the project secret carries full operator authority — a branch wanting
to widen the allowlist would call the allowlist endpoint directly rather than
bother with the CLI. So the table above is a convention until the server can express it,
which needs **a credential scoped to preview deploys and nothing else**: create
or renew a preview origin row, create a release, read the allowlist, and no write
to patterns, class or variables. ADR 036's `sk_team_` — "anything not listed
under MAY is denied", with lateral movement "mechanically impossible" — is the
shape to copy, and this is a prerequisite rather than an enhancement.

## `zitadel origins`

```
$ zitadel origins list
ORIGIN                                   KIND     SERVING          EXPIRES
https://app.acme.com                     primary  sha256:4a5b6c7d   —
https://www.acme.com                     primary  sha256:4a5b6c7d   —
https://acme-git-sso-acmeinc.vercel.app  preview  sha256:9f2c1a7b   in 6d

$ zitadel origins rm https://acme-git-sso-acmeinc.vercel.app
removed. 1 deployment record kept.
```

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
https://*-acmeinc.vercel.app      preview   tenant-anchored on `-acmeinc` ✓
https://*.preview.acme.com        preview   domain verified ✓

$ zitadel allowlist add 'https://*--acme-site.netlify.app' --kind preview
checked   netlify.app  tenant-unique label `acme-site`  ✓
added     covers every later branch; no deploy needed

$ zitadel allowlist add 'https://*.evil.com' --kind preview
error  origin_not_tenant_anchored
       `*.evil.com` carries no tenant-unique label, so the wildcard would
       admit every host under evil.com.
```

## `zitadel variables`

`set` and `list` address the store, `resolve --origin` reads the snapshot a
target is running — the transcripts are under
[Variables](3-variables.md#setting-one). Two commands because they answer two questions, and
conflating them is how "I set it and nothing happened" happens.

```
$ zitadel variables rm GOOGLE_CLIENT_ID_PREVIEW
removed from the store. 2 deployments still reference it; they are unaffected.
```

Removing from the store never reaches a snapshot, which is the whole point of
[runtime immutability](3-variables.md#immutability-at-runtime) — and the reason the message
says so out loud rather than reporting a bare success.

## `zitadel rollback`

```
$ zitadel rollback --origin https://app.acme.com
HISTORY for https://app.acme.com
  1  sha256:9f2c1a7b  10-02 14:52  deploy    (current)
  2  sha256:4a5b6c7d  10-02 09:30  rollback
  3  sha256:c3f7a8b2  10-01 17:02  deploy

roll back to? [2] 2
deployed    dep_01KB9X2M4P7S  reason=rollback  release=sha256:4a5b6c7d
```

Rollback appends, so rolling back and forward leaves a readable trail.

## `zitadel dev`

```
$ zitadel dev
watching .zitadel/
server   http://localhost:8080  (local)
project  prj_01KDEV…            class=sandbox
app      http://project-a.localhost:3000

14:22:01  flows/login.json changed
14:22:01  release sha256:c3f7a8b2 (new, not activated)
14:22:01  runtime document updated — reload to see it
```

## `zitadel env`

```
$ zitadel env
stage        production          VERCEL_ENV
server       https://api.zit…    ZITADEL_URL (process env)
project      prj_01K9AA9M3K…     .env.production.local
token        sk_proj_9f2H…       process env
release      sha256:9f2c1a7b     (built from working copy, not yet deployed)

consulted, in order:
  --server/--project flags      (not set)
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
enforced.
