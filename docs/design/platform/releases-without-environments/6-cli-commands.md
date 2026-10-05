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
serves. The list is the targets `deploy` ships to — the default and the `primary`
origins — plus the preview for the current branch if there is one. Every target
the project has is `zitadel deployments --live`.

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
platform    vercel  (VERCEL_BRANCH_URL)
origin      https://acme-git-sso-acmeinc.vercel.app
            matches https://*-acmeinc.vercel.app (preview)  ✓

building    3 changed resources
release     sha256:9f2c1a7b  (exists, reusing)
origin      created, expires 2026-10-09T14:10:00Z
deployed    dep_01KB3F8N2P9S5WQZ
```

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
  "targets": ["https://acme-git-sso-acmeinc.vercel.app"],
  "reason":  "deploy",
  "ttl":     "7d"
}
```

The same string therefore arrives by two routes: **declared** at deploy time,
backed by the project secret, and **attested** at request time by the browser's
`Origin` header. The allowlist binds them — a declared origin is checked against
the project's patterns at deploy time, so a preview row can never exist for a
URL the project does not allow.

Origin resolution, highest priority first:

1. `--origin <url>`
2. The platform's **branch-stable** URL — `VERCEL_BRANCH_URL`,
   `DEPLOY_PRIME_URL`, `CF_PAGES_URL`
3. Error naming the variables it looked for

Branch-stable, not per-deployment: `VERCEL_URL` and `DEPLOY_URL` change on every
push, which would write a new row on every push and leave the reviewer's link
pointing at one nothing renews.

Re-running on the next push renews `expires_at` and appends a deployment for
that same origin, so the preview URL is stable across pushes and an abandoned
branch's row expires and is deleted.

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
project state, [not repository content](2-origins.md#why-the-allowlist-is-not-in-zitadeljson).
What a PR job does hold is a credential, and that is the part still to solve.

| | `zitadel deploy` | `zitadel preview` |
|---|---|---|
| Runs in | the production job, after merge | a PR job, unreviewed branch |
| Allowlist patterns | read-only — `zitadel allowlist` is its own command | read-only |
| Project class | may change | may not |
| Variables | may set | may not — and sends none |
| Origin rows | `primary` | creates or renews one `preview` row |

So the first preview on a branch needing a brand-new pattern fails with
`proj.origin_not_allowed`, and the fix is for someone holding `project.write` to
add it — once, since one pattern covers every later branch.

**A division the CLI enforces is not a boundary.** The project secret carries
full operator authority, so a branch wanting to widen the allowlist would call
the endpoint directly rather than bother with the CLI. The table above is
therefore a convention until the server can express it, which needs **a
credential scoped to preview deploys and nothing else**: create or renew a
preview row, create a release, read the allowlist, and no write to patterns or
class. ADR 036's `sk_team_` — "anything not listed under MAY is
denied" — is the shape to copy. See [Prerequisites](#prerequisites).

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
https://*-acmeinc.vercel.app      preview   tenant-anchored on `-acmeinc` ✓
https://*.preview.acme.com        preview   domain verified ✓

$ zitadel allowlist add 'https://*--acme-site.netlify.app' --kind preview
checked   netlify.app  tenant-unique label `acme-site`  ✓
added     covers every later branch; no deploy needed

$ zitadel allowlist add 'https://*.evil.com' --kind preview
error  origin_not_tenant_anchored
       `*.evil.com` carries no tenant-unique label, so the wildcard would
       allow every host under evil.com.
```

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

```
$ zitadel rollback --origin https://app.acme.com
HISTORY for https://app.acme.com
  1  sha256:9f2c1a7b  10-02 14:52  deploy    (current)
  2  sha256:4a5b6c7d  10-02 09:30  rollback
  3  sha256:c3f7a8b2  10-01 17:02  deploy

roll back to? [2] 2
deployed    dep_01KB9X2M4P7S  reason=rollback  release=sha256:4a5b6c7d
```

The history it prints is `zitadel deployments --origin <url>`; rollback is that
view plus a write. Rolling back appends, so rolling back and forward leaves a
readable trail.

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
enforced.
