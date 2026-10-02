# Releases Without Environments

> **Status:** Spike — [#1389](https://github.com/zitadel/nextgen/issues/1389).
> Design only; nothing here is implemented.
>
> **Related:** [ADR 035](../../adrs/035-configuration-environments.md) (releases
> and deployments), [ADR 036](../../adrs/036-api-credential-planes.md)
> (credential planes, the publishable key),
> [ADR 062](../../adrs/062-per-environment-variables-and-secrets.md) (variables),
> [security and origins](../api/security-and-origins.md),
> [project secret](secret.md), [configuration surface](configuration-surface.md).

The server has no environments. Two things take their place:

- **Which server and project** a client talks to is resolved on the client, from
  the process environment and `.env` files. A stage is a `(server, project)`
  pair; the word `staging` never reaches the server.
- **Which release** is served is resolved per request, from the exact origin the
  request arrived on. A preview is an origin serving a release.

## Entities

Field names are proposals, not settled wire contracts.

### Project

```json
{
  "id": "prj_01K9AA9M3K7E2QX8VB4T",
  "name": "acme",
  "class": "production",
  "publishable_key": "pk_7kR2pXq9vN3wLmYhT4cB8A",

  "allowed_origins": [
    { "pattern": "https://app.acme.com",         "kind": "primary" },
    { "pattern": "https://www.acme.com",         "kind": "primary" },
    { "pattern": "https://*-acmeinc.vercel.app", "kind": "preview" },
    { "pattern": "https://*.preview.acme.com",   "kind": "preview" }
  ],

  "current_deployment_id": "dep_01KA7T9QX3M2E8VB",
  "created_at": "2026-04-21T14:03:11Z"
}
```

`allowed_origins` holds **patterns**. They authorize; they never route.
`current_deployment_id` answers callers that have no `Origin` to route on — a
server-side app, the CLI, CI.

### Origin

One row per live URL, keyed `(project_id, origin)`. Exact strings, no patterns.
This is what a request routes on.

```json
{
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "origin": "https://app.acme.com",
  "kind": "primary",
  "current_deployment_id": "dep_01KA7T9QX3M2E8VB",
  "created_at": "2026-04-22T09:17:45Z"
}
```

```json
{
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "origin": "https://acme-git-sso-acmeinc.vercel.app",
  "kind": "preview",
  "current_deployment_id": "dep_01KB3F8N2P9S5WQZ",
  "expires_at": "2026-10-09T14:10:00Z",
  "created_at": "2026-10-02T14:10:00Z"
}
```

`expires_at` is preview-only and is renewed by deploying to the same origin
again, which keeps a preview URL stable across pushes to a branch. `primary` rows
do not expire.

### Deployment

Immutable, append-only.

```json
{
  "id": "dep_01KB3F8N2P9S5WQZ",
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "deploy_id": "dpl_01KB3F8N2P9S5WQY",
  "origin": "https://acme-git-sso-acmeinc.vercel.app",
  "release": "sha256:9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382",
  "reason": "deploy",
  "message": "add phone_number to human-user",
  "deployed_at": "2026-10-02T14:10:00Z",
  "deployed_by": "user_01K8ZQ3K7E5M2P9S"
}
```

`origin` is the history axis. The **empty string means the project default** —
the target `project.current_deployment_id` points at. `deploy_id` correlates the
rows one deploy wrote when it touched several origins at once.

### Release

```json
{
  "digest": "sha256:9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382",
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "pointers": [
    { "kind": "schema",          "handle": "human-user",    "revision_id": "sch_01KWHF18816ZQE" },
    { "kind": "flow_definition", "handle": "default-login", "revision_id": "flowdef_01KWHG09JXA" },
    { "kind": "branding",        "handle": "default",       "revision_id": "brnd_01KWH1P4MYS" }
  ],
  "metadata": {
    "message": "add phone_number to human-user",
    "git_sha": "4a5b6c7d8e9f0a1b2c3d",
    "git_dirty": false,
    "created_by": "user_01K8ZQ3K7E5M2P9S",
    "created_at": "2026-10-02T14:08:55Z"
  },
  "revoked_at": null
}
```

`digest` is a SHA-256 over the sorted pointer set with metadata excluded, and it
is the wire identifier. A minted `rel_<ULID>` stays as the storage primary key.
Short forms are accepted down to 12 hex characters; ambiguity is refused.

Posting the same content twice returns the same release rather than creating a
second one.

### Variable

Keyed `(name, project_id, scope)`, where `scope` is an allowlist **pattern** and
the empty string is the project.

```json
{ "name": "GOOGLE_CLIENT_ID", "scope": "", "value": "prod-abc.apps.googleusercontent.com" }
{ "name": "GOOGLE_CLIENT_ID", "scope": "https://*-acmeinc.vercel.app",
  "value": "preview-xyz.apps.googleusercontent.com" }
{ "name": "GOOGLE_CLIENT_SECRET", "scope": "https://*-acmeinc.vercel.app", "secret": true }
```

## Resolution

Project comes from the credential where one exists — the publishable key or the
project secret. A body `project_id` that disagrees is `403`.

Then the release, in three layers:

1. **Gate.** `Origin` present and matching no `allowed_origins` pattern → `403`.
   `Origin` absent falls through; there is nothing to check.
2. **Route.** An origin row for this exact `Origin` → serve the release its
   `current_deployment_id` points at. The caller sends nothing and needs to know
   nothing. This answers almost all browser traffic.
3. **Fall back.** No origin row. An explicit `X-Zitadel-Release` header wins if
   present and permitted; otherwise `project.current_deployment_id`.

Both pointers are needed: layer 2 requires an `Origin` to match, and a
server-side app sends none.

**Who may use the header.** On a `production` project it requires the publishable
key or the project secret, so an anonymous pin is refused. On a `sandbox` project
it is open. A `preview` pattern matched at layer 1 with no row at layer 2 and no
permitted header is `400` — a preview URL must never silently fall through to
production configuration.

**Sealing.** The resolved release is written into the flow state at the first
step and reused for the rest of the attempt, so a deploy landing mid-sign-in
cannot change the configuration under the user.

### Errors

| Condition | Status | Code |
|---|---|---|
| `Origin` matches no pattern | 403 | `proj.origin_not_allowed` |
| Body `project_id` disagrees with the credential | 403 | `proj.mismatch` |
| Header used without a credential on a `production` project | 403 | `rel.pin_not_permitted` |
| `preview` pattern matched, no row and no permitted header | 400 | `rel.required` |
| Digest names a release of another project, or none | 404 | `rel.not_found` |
| Short digest matches more than one release | 400 | `rel.ambiguous` |
| Release revoked | 409 | `rel.revoked` |
| Revoking a release an origin row serves | 409 | `rel.in_service` |
| Loopback origin, or a wildcard `primary` entry, on a `production` project | 400 | `proj.origin_not_permitted_for_class` |
| Shared-host wildcard that is not tenant-anchored | 400 | `proj.origin_not_tenant_anchored` |
| Shared-host wildcard on an unknown host | 400 | `proj.origin_host_unknown` |
| Passkey ceremony from an origin whose RP ID cannot match | 400 | `flow.passkey_rp_unavailable` |

## Worked examples

All against the project above: `class: production`, primary `app.acme.com` and
`www.acme.com`, preview patterns `*-acmeinc.vercel.app` and
`*.preview.acme.com`.

### 1. A browser on the production origin

```http
POST /flow HTTP/1.1
Origin: https://app.acme.com
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches `https://app.acme.com` (primary) ✓ |
| 2 route | row found → `dep_01KA7T9QX3M2E8VB` → `sha256:4a5b…` |

Serves `sha256:4a5b…`. The client sent no release and knows of none.

### 2. A preview whose deploy registered its origin

```http
POST /flow HTTP/1.1
Origin: https://acme-git-sso-acmeinc.vercel.app
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches `https://*-acmeinc.vercel.app` (preview) ✓ |
| 2 route | row found → `dep_01KB3F8N2P9S5WQZ` → `sha256:9f2c…` |

Serves the branch's own release. Byte-identical to example 1 except the `Origin`.

Passkey assertion with a production credential fails here — see
[Passkeys](#passkeys-and-preview-origins).

### 3. A preview that could not register its origin

```http
POST /flow HTTP/1.1
Origin: https://acme-git-hotfix-acmeinc.vercel.app
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A
X-Zitadel-Release: sha256:81de4c…

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches the preview pattern ✓ |
| 2 route | no origin row |
| 3 fall back | header present, publishable key present → `sha256:81de4c…` |

Drop the `Authorization` header and this is `403 rel.pin_not_permitted`; drop
`X-Zitadel-Release` instead and it is `400 rel.required`.

### 4. A server-side app, no `Origin`

```http
POST /flow HTTP/1.1
Authorization: Bearer sk_proj_9f2Hx8LqT4vRmYpN2wCbVa

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | no `Origin`, nothing to check |
| 2 route | nothing to match on |
| 3 fall back | no header → `project.current_deployment_id` → `sha256:4a5b…` |

This is why the project pointer exists: the caller has no origin, so there is no
row to find. Add `X-Zitadel-Release` to pin a release — the project secret
permits it on any class.

### 5. A stranger on an unrelated Vercel app

```http
POST /flow HTTP/1.1
Origin: https://evil-xyz-attacker.vercel.app
X-Zitadel-Release: sha256:9f2c1a…

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | `*-acmeinc.vercel.app` requires the `-acmeinc` suffix → no match |

`403 proj.origin_not_allowed`, before any release is considered.

### 6. A stranger who does match the pattern

```http
POST /flow HTTP/1.1
Origin: https://acme-git-nonsense-acmeinc.vercel.app
X-Zitadel-Release: sha256:9f2c1a…

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches the preview pattern ✓ |
| 2 route | no row for this exact host |
| 3 fall back | header present, **no credential** on a `production` project |

`403 rel.pin_not_permitted`. Knowing the digest bought nothing, which is the
point of resolving from the origin rather than from a value the client supplies.

### 7. Local development

Same project but `class: sandbox`, so the header is open.

```http
POST /flow HTTP/1.1
Origin: http://project-a.localhost:3000
X-Zitadel-Release: sha256:c3f7a8…

{ "project_id": "prj_01KDEV…", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | loopback, permitted on `sandbox` ✓ |
| 2 route | no row — nobody registers localhost |
| 3 fall back | header present, no credential needed → `sha256:c3f7a8…` |

The digest comes from the local runtime document rather than a build constant, so
a `.zitadel/` edit shows on the next page load.

### Summary

| # | `Origin` | Credential | Header | Answered by | Result |
|---|---|---|---|---|---|
| 1 | primary | publishable key | — | layer 2 | production release |
| 2 | registered preview | publishable key | — | layer 2 | branch release |
| 3 | unregistered preview | publishable key | yes | layer 3 | named release |
| 4 | none | project secret | — | layer 3 | project default |
| 5 | unmatched | — | yes | layer 1 | `403 origin_not_allowed` |
| 6 | matched preview | none | yes | layer 3 | `403 pin_not_permitted` |
| 7 | loopback (`sandbox`) | — | yes | layer 3 | named release |

## Deployment history

History is the set of deployment rows naming a target, newest first.

```sql
-- what app.acme.com is serving, and what it served before
SELECT * FROM deployments
 WHERE project_id = ? AND origin = 'https://app.acme.com'
 ORDER BY deployed_at DESC, id DESC;

-- the project default's history (callers with no Origin)
SELECT * FROM deployments
 WHERE project_id = ? AND origin = ''
 ORDER BY deployed_at DESC, id DESC;
```

Supporting index: `(project_id, origin, deployed_at DESC, id DESC)`.

Four rules:

1. **Rows are never mutated; a pointer move is an insert.** Deploy, rollback and
   redeploy all append. The two `current_deployment_id` columns are denormalised
   caches of "the newest row for this target", kept so a read is one row and an
   optimistic-concurrency check is one compare.
2. **`deployments.origin` is a plain string, not a foreign key.** A preview
   origin can be collected and its history stays. A cascade would delete the
   audit trail of every expired preview.
3. **A release referenced by any deployment row is never collected.** Only
   never-deployed releases are collectable. A dangling `current_deployment_id`
   reads as "nothing running" and repairs on the next deploy.
4. **Point-in-time is a query, not a column.** "What was `app.acme.com` serving
   on 1 October" is the newest row for that origin with
   `deployed_at <= '2026-10-01'`. No `superseded_at`, no validity ranges.

### Example

One project, three targets, read as one log.

| `deployed_at` | `origin` | `release` | `reason` | `deploy_id` |
|---|---|---|---|---|
| 10-02 14:10 | `acme-git-sso…vercel.app` | `sha256:9f2c…` | `deploy` | `dpl_…Y` |
| 10-02 09:30 | `` (default) | `sha256:4a5b…` | `rollback` | `dpl_…W` |
| 10-02 09:30 | `app.acme.com` | `sha256:4a5b…` | `rollback` | `dpl_…W` |
| 10-02 09:30 | `www.acme.com` | `sha256:4a5b…` | `rollback` | `dpl_…W` |
| 10-01 17:02 | `` (default) | `sha256:c3f7…` | `deploy` | `dpl_…V` |
| 10-01 17:02 | `app.acme.com` | `sha256:c3f7…` | `deploy` | `dpl_…V` |
| 10-01 17:02 | `www.acme.com` | `sha256:c3f7…` | `deploy` | `dpl_…V` |
| 09-28 11:44 | `acme-git-pw…vercel.app` | `sha256:81de…` | `deploy` | `dpl_…U` |

The 17:02 release went bad and was rolled back at 09:30 across all three
production targets in one operation — one `deploy_id`, three rows, each
independently rollback-able afterwards. The 09-28 preview has since expired and
its origin row is gone, yet its deployment row is still here.

**Known limitation.** A target's history is its hostname's. Rename a production
hostname and a new history starts, with the old one readable under the old string
but not joined to it. If that matters, the fix is a nullable `target_id` grouping
origins that are "the same place over time" — worth adding only when something
concrete demands it.

## Origins

Two records with different jobs.

| | **Allowlist** | **Inventory** |
|---|---|---|
| What it is | a rule | a fact |
| Written by | a human, in `zitadel.json`, reviewed in a PR | a deploy |
| Shape | patterns | exact origins |
| Lifetime | as long as the project | as long as the deployment it records |
| Answers | may traffic from here be served? | what is this URL serving? |
| Can route? | no — a pattern matches many hosts | yes |

Matching: `*` matches one or more characters, none of which is `.`. Where a
request matches more than one pattern, the more specific wins — a literal beats a
wildcard.

### The tenant-anchor rule

`https://*.vercel.app` authorizes everybody's Vercel deployments. Every preview
host puts a globally unique, tenant-owned label in its hostname, adjacent to the
registrable domain:

| Host | Hostname shape | Tenant-unique label | Safe pattern |
|---|---|---|---|
| Vercel | `<project>-<hash>-<team>.vercel.app` | team slug | `https://*-acmeinc.vercel.app` |
| Netlify | `<branch>--<site>.netlify.app` | site name | `https://*--acme-site.netlify.app` |
| Cloudflare Pages | `<hash>.<project>.pages.dev` | project name | `https://*.acme-app.pages.dev` |

> A wildcard may only replace characters to the **left** of the tenant-unique
> label. Every character from that label rightward must be fixed.

This reads backwards from intuition. **`https://acme-*.vercel.app` is not
safe** — anyone can create a Vercel project named `acme` under their own team and
deploy to `acme-xyz-attacker.vercel.app`, which matches. Suffix anchoring is what
works; prefix anchoring is worth nothing.

Checking this requires a registry recording, per host, where the tenant-unique
label sits. A pattern on an unregistered shared host is rejected on a
`production` project.

## Project class

```
project.class: sandbox | production
```

| | `sandbox` (default) | `production` |
|---|---|---|
| Loopback origins | allowed | rejected at save |
| Empty allowlist (allow-all) | allowed | rejected; non-empty is mandatory |
| `primary` entries | any known shape | exact origins only, no wildcards |
| `preview` entries, own domain | allowed | allowed, domain ownership verified |
| `preview` entries, shared host | allowed, any known host | allowed, tenant-anchored |
| Release pinning by header | open | requires the publishable key or project secret |

Transitions:

- **`sandbox` → `production`** revalidates every stored origin and fails, naming
  each offender, if any violates the `production` column. Requires a claimed
  project.
- **`production` → `sandbox`** re-admits loopback origins to a project holding
  real users. Requires explicit confirmation from the claim holder, and is
  audited.

### Previews on a production project

Permitted. A preview must name its release, and there are two ways:

- **Preferred — the deploy registers an origin row** for the exact preview URL.
  Layer 2 answers, the client sends nothing, and a stranger reaching a matching
  wildcard has no row of their own.
- **Fallback — the build injects `X-Zitadel-Release`**, for platforms with no
  registration step. Requires the publishable key on a `production` project.

Neither present is `400`, never the project's current release.

### Passkeys and preview origins

The WebAuthn relying-party id is derived from the origin hostname, and a
credential is only assertable under the RP ID it was registered with. So a
passkey registered at `app.acme.com` is not offered to a page on
`acme-git-foo-acmeinc.vercel.app`. The browser enforces this; no server setting
changes it.

| Preview origin | May name a release | Passkey with production credentials |
|---|---|---|
| Own domain, `*.preview.acme.com` | yes | **yes** — if RP ID is a project setting |
| Shared host, `*-acmeinc.vercel.app` | yes | **no** — `vercel.app` is a public suffix, so no tenant may claim it as an RP ID |

A shared-host preview can exercise password, one-time-code and social sign-in
against real users, and not passkey assertion.

For own-domain previews to work, **the RP ID has to be a project setting** — the
registrable domain, `acme.com`, validated as a suffix of every `primary`
origin — rather than derived per request from the full hostname. Then
`app.acme.com` and `foo.preview.acme.com` both claim RP ID `acme.com` and
credentials are portable between them.

## Variables

A preview on a production project must be able to use a different IdP client than
production, without being moved off that project.

```json
{ "name": "GOOGLE_CLIENT_ID", "scope": "", "value": "prod-abc.apps.googleusercontent.com" }
{ "name": "GOOGLE_CLIENT_ID", "scope": "https://*-acmeinc.vercel.app",
  "value": "preview-xyz.apps.googleusercontent.com" }
```

A flow served at `acme-git-sso-acmeinc.vercel.app` resolves the preview client;
the same release served at `app.acme.com` resolves the production one. Same
release, same project, different credentials.

**The pattern is the key, not the origin row.** A preview origin is created per
branch and collected on expiry; setting a secret on every new branch URL would
defeat having a wildcard pattern. A pattern is authored once and reviewed.

**Resolution is override, not exact match.** For each `${{ NAME }}`: the value
scoped to the matching pattern if one exists, otherwise the project's, otherwise
the placeholder is left as-is. Without override, a preview scope would have to
redefine every variable rather than the two that differ. This is the inheritance
model ADR 062 names as its own follow-up under *Resolving variables*.

Two consequences:

- **A preview silently uses production credentials unless told otherwise.** That
  is the sensible default. A pattern could mark named variables as
  non-inheritable, failing the flow closed instead.
- **The allowlist becomes a table rather than a JSON column**, since entries
  carry a `kind`, a verification state, and now own variables.

## Promotion

CI posts the same content to the staging project and then the production project
and asserts the two digests match. If they differ, the content differed and the
deploy fails.

This needs a digest computed over resource **content** rather than over revision
ids, since revision ids are per-project. A content digest is reproducible across
projects; a pointer digest is not.

`zitadel promote` has no server surface: it is `deploy` against the other target
with a digest assertion.

## Local development

### Several developers, one shared project

Five developers on `http://localhost:3000` against one shared `sandbox` project,
each with their own `.zitadel/` edits. The origin cannot separate them; the
release digest can.

1. A developer edits `.zitadel/flows/login.json`.
2. The dev-server hook **builds a release and does not activate it**. Identical
   content across two developers reuses one release.
3. The digest lands in the local runtime document.
4. The browser sends it as `X-Zitadel-Release`.
5. The shared project's pointer is never touched.

> **In the inner loop, nobody activates.** Building a release is a save;
> activating one is a deploy. Only CI, or an explicit `zitadel deploy`, moves a
> pointer.

In development the digest is read per request from the runtime document rather
than baked into the build, so a `.zitadel/` edit shows on the next page load. In
a deployed app it is a build constant.

Cost: a release row per distinct local content state, all never-activated. A
never-activated, cold release past its retention window is collectable.

### Developers on different projects

Project resolution comes from the credential or the request and **never from the
origin**, so `http://localhost:3000` appearing in two projects' allowlists is not
ambiguous. A loopback entry in an allowlist authorizes nothing in particular,
which is why loopback is confined to `sandbox` projects.

The one real collision is WebAuthn: RP ID drops the port, so project A on
`:3000` and project B on `:3001` both get RP ID `localhost`, and a developer's
browser accumulates one credential list spanning every project they work on.

The fix is a hostname per project, not a port per project. `*.localhost` resolves
to loopback and counts as a trustworthy origin, so `project-a.localhost` gives a
distinct RP ID with no TLS and no `/etc/hosts` editing. **The CLI should scaffold
a per-project local hostname rather than a bare port.**

Developers sharing a project share its users and sessions. A developer who needs
isolation uses their own project, which costs a `ZITADEL_PROJECT_ID` in
`.env.local`.

## The CLI

Transcripts are illustrative, not a committed surface.

### Target resolution

Two values per invocation: a server URL and a project id, plus a credential for
writes. Each resolves independently, highest priority first:

1. `--server`, `--project`
2. `process.env` — so a platform's environment store and CI beat anything on disk
3. `.env.<stage>.local`
4. `.env.local` — skipped when the stage is `test`
5. `.env.<stage>`
6. `.env`
7. `zitadel.json`, public-safe values only — never the secret
8. `.zitadel/secret`, for project id and secret
9. Interactive prompt, TTY only, persisted to `.env.<stage>.local`
10. Error naming the stage, the missing value, and every file consulted

Stage detection, highest priority first: `--env`, `ZITADEL_ENV`, platform signals
(`VERCEL_ENV`, `NETLIFY_CONTEXT`, `RAILWAY_ENVIRONMENT`), `NODE_ENV`,
`development`. The stage is local only; it selects which `.env` files to read and
never reaches the server.

**Dotenv never overrides the real process environment.** A platform injecting
`ZITADEL_PROJECT_ID` must beat a committed `.env`, or a preview deploy silently
talks to the wrong project.

| Variable | Notes |
|---|---|
| `ZITADEL_URL` | server base URL |
| `ZITADEL_PROJECT_ID` | project |
| `ZITADEL_PROJECT_SECRET` | CLI and server-side SDK |
| `ZITADEL_RELEASE` | set by the build; read by the server-side SDK |
| `NEXT_PUBLIC_ZITADEL_RELEASE` / `VITE_…` / `NUXT_PUBLIC_…` | browser bundle |

The release variables are only needed on the fallback path. A browser caller
answered by layer 2 sends nothing new.

### `zitadel status`

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

### `zitadel deploy`

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

### `zitadel preview`

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
  "origin":  "https://acme-git-sso-acmeinc.vercel.app",
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

#### `preview` must not be able to widen the allowlist

`zitadel preview` runs in a **pull-request** job, from a branch anyone with PR
access can write — including `zitadel.json`. If it synced the allowlist the way
`deploy` does, a branch could add `https://*.evil.com` to a production project's
patterns and deploy an origin row under it.

| | `zitadel deploy` | `zitadel preview` |
|---|---|---|
| Runs in | the production job, after merge | a PR job, unreviewed branch |
| Allowlist patterns | synced from `zitadel.json` | read-only |
| Project class | may change | may not |
| Variables | may set | may not |
| Origin rows | `primary` | creates or renews one `preview` row |

So a new preview pattern takes effect only once merged. The first preview on a
branch needing a brand-new pattern fails with `proj.origin_not_allowed`, and the
fix is to land the pattern.

**A division the CLI enforces is not a boundary.** A PR job needs a credential to
deploy, and the project secret carries full operator authority — a branch wanting
to widen the allowlist would call `PATCH /projects` directly rather than bother
with the CLI. So the table above is a convention until the server can express it,
which needs **a credential scoped to preview deploys and nothing else**: create
or renew a preview origin row, create a release, read the allowlist, and no write
to patterns, class or variables. ADR 036's `sk_team_` — "anything not listed
under MAY is denied", with lateral movement "mechanically impossible" — is the
shape to copy, and this is a prerequisite rather than an enhancement.

### `zitadel origins`

```
$ zitadel origins list
ORIGIN                                   KIND     SERVING          EXPIRES
https://app.acme.com                     primary  sha256:4a5b6c7d   —
https://www.acme.com                     primary  sha256:4a5b6c7d   —
https://acme-git-sso-acmeinc.vercel.app  preview  sha256:9f2c1a7b   in 6d

$ zitadel origins rm https://acme-git-sso-acmeinc.vercel.app
removed. 1 deployment record kept.
```

The allowlist is a separate command, because patterns are authored in
`zitadel.json` and synced rather than managed imperatively:

```
$ zitadel allowlist
PATTERN                           KIND
https://app.acme.com              primary
https://www.acme.com              primary
https://*-acmeinc.vercel.app      preview   tenant-anchored on `-acmeinc` ✓
https://*.preview.acme.com        preview   domain verified ✓
```

### `zitadel variables`

```
$ zitadel variables list
NAME                  SCOPE                             VALUE
GOOGLE_CLIENT_ID      (project)                         prod-abc.apps.googleu…
GOOGLE_CLIENT_SECRET  (project)                         ********
GOOGLE_CLIENT_ID      https://*-acmeinc.vercel.app      preview-xyz.apps.goog…
GOOGLE_CLIENT_SECRET  https://*-acmeinc.vercel.app      ********

$ zitadel variables resolve --origin https://acme-git-sso-acmeinc.vercel.app
matched https://*-acmeinc.vercel.app (preview)

NAME                  VALUE                             FROM
GOOGLE_CLIENT_ID      preview-xyz.apps.googleu…         pattern
GOOGLE_CLIENT_SECRET  ********                          pattern
SUPPORT_EMAIL         help@acme.com                     project (inherited)
```

`resolve` exists because with two scope levels and override, "which value will
this URL actually get" stops being answerable by reading the config.

### `zitadel rollback`

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

### `zitadel dev`

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

### `zitadel env`

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

Three things this design needs that do not exist yet.

- **A working origin matcher and a preview-host registry.** Matching is exact
  string equality today, so wildcard patterns match nothing at all.
- **A preview-deploy credential**, narrower than the project secret, or the
  deploy/preview trust division stays advisory.
- **RP ID as a project setting**, or own-domain previews cannot use production
  passkeys.

## Open

1. **Content digest or pointer digest on the wire.** A content digest is
   reproducible across projects, which is what makes promotion checkable; a
   pointer digest is unguessable, which matters on the fallback-header path.
   Keeping both — pointer digest on the wire, content digest for CI assertions —
   is probably the answer.
2. **Whether `current_deployment_id` belongs on the project and origin rows** or
   is derived from the newest deployment.
3. **Release retention window, and what counts as "cold".** A last-resolved
   timestamp is a write on the hot path; an approximation avoids one.
4. **Who maintains the preview-host registry** when a platform changes its URL
   shape. A stale entry either rejects legitimate patterns or accepts one that is
   no longer tenant-anchored. Shipping it as data rather than code lets it be
   corrected without a release.
5. **Exact-URL registration instead of wildcards.** CI registers the exact
   preview URL at deploy and removes it at teardown, which needs no registry and
   no anchor rule. The cost is origin entries with a TTL and a collector — which
   is what `expires_at` already is.
6. **Whether a preview may serve a release no target ever activated.** Requiring
   a row or a header stops a stranger, but not a developer pinning something
   unreviewed. Restricting previews to releases activated somewhere, or created
   recently, are both cheap narrowings.
7. **Whether `production` should require a claimed project** (this note says
   yes), and whether anything else currently claim-gated should move onto the
   class.
