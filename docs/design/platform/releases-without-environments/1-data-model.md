# Project Data Model

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

The server-side resources. Environments are gone; an origin row takes over the
job of saying what a URL serves, and a deployment row says what moved and when.

## Entities

Field names are proposals, not settled wire contracts.

Most of these tables already exist. What this design moves is the axis they are
keyed on: from an environment id to an origin string.

| Entity | Old Model | New Model |
|---|---|---|
| **Project** | `projects` | kept — `preview_origins` becomes `allowed_origins` with a `kind` per entry, plus `class` and `publishable_key` |
| **Origin** | — | **new table**, one row per live URL; takes over the routing job environments do |
| **Environment** | `environments`, seeded per project | **dropped** |
| **Deployment** | `deployments`, keyed to an environment | kept — the `environment_id` foreign key becomes a plain `origin` string, plus `deploy_id`. The newest row **is** the pointer; `environments.current_deployment_id` is not carried over |
| **Release** | `releases` | shape kept — `content_hash` becomes the wire identifier, `revoked_at` is new |
| **Variable** | `variables`, scoped by `environment_id` | kept — the scope column goes entirely; a variable is a name on the project |
| **Deployment variable** | — | **new table**, the immutable snapshot one deployment runs |

### Project

```jsonc
{
  "id": "prj_01K9AA9M3K7E2QX8VB4T",
  "name": "acme",

  "class": "production",                          // NEW
  "publishable_key": "pk_7kR2pXq9vN3wLmYhT4cB8A", // NEW - ADR 036 defines it, internal/ has none

  // CHANGED - today `preview_origins`: a flat list of exact strings
  // (internal/domain/project.go:68) compared with string equality
  // (internal/api/flow.go:371), serving only the preview secret. Now patterns,
  // each carrying a `kind` - see Why an origin has a kind for what reads it.
  "allowed_origins": [
    { "pattern": "https://app.acme.com",         "kind": "primary" },
    { "pattern": "https://www.acme.com",         "kind": "primary" },
    { "pattern": "https://*-acmeinc.vercel.app", "kind": "preview" },
    { "pattern": "https://*.preview.acme.com",   "kind": "preview" }
  ],

  // NOT CARRIED OVER - `environments.current_deployment_id` has no counterpart
  // here. What a target serves is the newest deployment row for it; the project
  // default is the newest row with origin "". See Why there is no pointer column.
  "created_at": "2026-04-21T14:03:11Z"
}
```

`allowed_origins` holds **patterns**. They authorize; they never route. Callers
that have no `Origin` to route on — a server-side app, the CLI, CI — are answered
by the project default, which is a query rather than a column. `updated_at` and
the password-hash policy are left out above and unaffected.

### Origin

One row per live URL, keyed `(project_id, origin)`. Exact strings, no patterns.
This is what a request routes on.

```jsonc
// NEW TABLE - every field is new. It takes over what an `environments` row did,
// keyed by an exact origin string instead of an `env_` id - except the pointer.
{
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "origin": "https://app.acme.com",
  "kind": "primary",
  "created_at": "2026-04-22T09:17:45Z"

  // The row says this origin is live and how it is treated. It does not say
  // what it serves - that is the newest deployment row carrying this origin.
}
```

```jsonc
{
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "origin": "https://acme-git-sso-acmeinc.vercel.app",
  "kind": "preview",
  "expires_at": "2026-10-09T14:10:00Z", // preview rows only; `primary` rows never expire
  "created_at": "2026-10-02T14:10:00Z"
}
```

#### Why an origin has a kind

`kind` is the switch four different rules read. Without it each of them would
need its own column or its own heuristic.

| | `primary` | `preview` |
|---|---|---|
| Wildcard pattern | refused on a `production` project | allowed, if [tenant-anchored](#the-tenant-anchor-rule) |
| Lifetime | never expires | `expires_at`, renewed by deploying again |
| Written by | `zitadel deploy` | `zitadel preview` |
| Matched at layer 1, no row at layer 2 | falls through to the project default | `400 rel.required` |

That last row is the one that matters most. A preview URL must fail closed: if
nothing registered it, serving it the production configuration would be worse
than refusing, because the whole point of the URL is that it is *not*
production. A primary hostname with no row is just a project that has only been
deployed to its default, which is fine to serve.

**It cannot be derived from the shape of the origin.** An exact preview URL a CI
run registered — `https://acme-git-sso-acmeinc.vercel.app` — is a literal string
indistinguishable from `https://app.acme.com`, and the two must behave
oppositely on expiry and on the fail-closed rule. Wildcards do not settle it
either: whether one is allowed is a question about the project's class, not
about the kind, so a `sandbox` project can hold a wildcard `primary` entry.

A row records the kind of the pattern that admitted it, at the time it was
admitted. So re-typing a pattern later does not silently make live previews
permanent, or retire a hostname that is serving traffic; the explicit path is
`zitadel origins rm` and a redeploy.

So `environments` is **dropped**: the table and its unique name index
(`000005_environments.sql`), `seedDefaultEnvironments`
(`internal/service/project.go:173`), and the name-addressed
`GET /environments/{name}` surface.

### Deployment

Immutable, append-only.

```jsonc
{
  "id": "dep_01KB3F8N2P9S5WQZ",
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",

  "deploy_id": "dpl_01KB3F8N2P9S5WQY", // NEW - correlates the rows one deploy wrote

  // CHANGED - today `environment_id`, a composite foreign key to `environments`
  // that cascades on delete (000011_deployments.sql). Now a plain string, no
  // foreign key, "" = the project default. Deliberate - see Deployment history.
  "origin": "https://acme-git-sso-acmeinc.vercel.app",

  // CHANGED - not the field, the constraint: the release foreign key cascades
  // today, so deleting a release deletes its deployments. It must restrict.
  "release": "sha256:9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382",

  // The variables this deployment runs are the `deployment_variables` rows
  // carrying its id - written in this same transaction, never updated.

  // These three already exist, inside the `metadata` document. Flat here for
  // readability only - nothing requires promoting them to columns.
  "reason": "deploy",
  "message": "add phone_number to human-user",
  "deployed_by": "user_01K8ZQ3K7E5M2P9S",

  "deployed_at": "2026-10-02T14:10:00Z"

  // DROPPED - metadata's `source_environment_id` and `source_environment_name`,
  // which recorded where a promotion came from. A promotion source is an origin
  // now, so those are replaced rather than renamed.
}
```

`origin` is the history axis. The **empty string means the project default** —
what a caller with no `Origin` gets. `deploy_id` correlates the
rows one deploy wrote when it touched several origins at once. Dropping the
foreign key is the point rather than an oversight — see
[deployment history](#deployment-history).

### Release

```jsonc
{
  // CHANGED - not the column, its job. This is today's `content_hash`, already
  // the dedup key; here it is also the identifier on the wire.
  "digest": "sha256:9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382",

  // UNCHANGED from here down - pointers, metadata and the actor fields are
  // exactly what `releases` already stores.
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

  "revoked_at": null // NEW
}
```

`digest` is a SHA-256 over the sorted pointer set with metadata excluded, and it
is the wire identifier. A minted `rel_<ULID>` stays as the storage primary key.
Short forms are accepted down to 12 hex characters; ambiguity is refused.

Posting the same content twice returns the same release rather than creating a
second one — which is current behaviour, not a proposal: the unique index on
`(project_id, content_hash)` already enforces it (`000007_releases.sql`).

### Variable

Keyed `(project_id, name)`. Nothing else — no scope, no pattern, no level.

```jsonc
// CHANGED - the `environment_id` column is removed rather than repurposed.
// A variable is a name on the project, and the only key is the name. With the
// snapshot below holding what a target runs, a second targeting mechanism in
// here would do the same job twice.
//
// So the generated `environment_ref` column, its foreign key, and the ""
// convention (internal/domain/variable.go:160) all go with it
// (`000008_variables.sql`).
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_ID",
  "value": "prod-abc.apps.googleusercontent.com", "is_secret": false }

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_SECRET",
  "secret_version": "svs_01KB3F8N2P9S5WQX", "is_secret": true }
```

### Deployment variable

```jsonc
// NEW TABLE - keyed (project_id, deployment_id, name). Written once, in the
// transaction that writes the deployment row, and never updated. This is what
// a request reads; the table above is only what the next deploy will read.
{
  "project_id":    "prj_01K9AA9M3K7E2QX8VB4T",
  "deployment_id": "dep_01KB3F8N2P9S5WQZ",
  "name":          "GOOGLE_CLIENT_ID",
  "value":         "preview-xyz.apps.googleusercontent.com"
}
{
  "project_id":     "prj_01K9AA9M3K7E2QX8VB4T",
  "deployment_id":  "dep_01KB3F8N2P9S5WQZ",
  "name":           "GOOGLE_CLIENT_SECRET",
  "secret_version": "svs_01KB3F8N2P9S5WQY" // referenced, never copied
}
```

## Origins

Two records with different jobs.

| | **Allowlist** | **Inventory** |
|---|---|---|
| What it is | a rule | a fact |
| Written by | a person holding `project.write`, one pattern at a time | a deploy |
| Shape | patterns | exact origins |
| Lifetime | as long as the project | as long as the deployment it records |
| Answers | may traffic from here be served? | what is this URL serving? |
| Can route? | no — a pattern matches many hosts | yes |

Matching: `*` matches one or more characters, none of which is `.`. Where a
request matches more than one pattern, the more specific wins — a literal beats a
wildcard.

### Managing the allowlist

There is no endpoint for this today. `preview_origins` appears in
`create-project-request.yaml` and in `project-response.yaml`, but **not** in
`patch-project-request.yaml`, which carries only `name` and `password_hash`. So
origins can be set once, at project creation, and never changed afterwards.

**It is project state, not release content.** It has to be: layer 1 of
[resolution](2-release-resolution.md#the-three-layers) decides whether to serve this origin at all, and it
runs *before* the release is known. An allowlist inside the release would need
the release in order to choose the release. That also settles the
lifecycle: the allowlist outlives every release in the project, so
`zitadel rollback` moves releases and leaves it alone, and `zitadel deploy` never
touches it.

**Its own sub-resource, not a `patchProject` field.** `patchProject` carries
`security: [oauth2: [project.write], nextgenSession: []]`, and the session
alternative is there so "a granted person may rename a project they can act on".
Renaming is benign; admitting an origin is the security-relevant act in this
whole design. Putting both behind one operation would let a session-authenticated
grantee widen the allowlist, which is also precisely what the preview-deploy
credential of [Prerequisites](4-cli-commands.md#prerequisites) must not be able to do. A separate
operation lets the two have different security without field-level authorization
inside one request body.

| Change | Where |
|---|---|
| `POST /projects/{project_id}/allowed_origins` — add one `{pattern, kind}`, `project.write` only, no session fallback | new `endpoints/projects/by_id/allowed_origins/methods.yaml`, registered in `openapi-spec.yaml` |
| `DELETE /projects/{project_id}/allowed_origins` — remove one, pattern in the request body rather than a path segment, since a pattern contains `/` and `*` | the same file |
| `preview_origins` → `allowed_origins`, entries become `{pattern, kind}` | `create-project-request.yaml` and `project-response.yaml` — the latter also covers `GET /projects/{id}` and `/projects/query`, which `$ref` it |
| `class` on the project | `project-response.yaml`, plus a promote/demote operation, since a class change revalidates every pattern |
| Rejections: `origin_not_permitted_for_class`, `origin_not_tenant_anchored`, `origin_host_unknown` | the new operation's error response, and `createProject-error-response.yaml` |

**Add and remove, not replace.** With no file acting as desired state, a `PUT`
would make the CLI read the list, edit it and write it back, losing a concurrent
addition in the window between. One pattern per call has no such window and needs
no `If-Match`. A whole-list `PUT` is the right primitive the day a declarative
file exists, and not before.

The inventory needs no such endpoint. Origin rows are written by deploys and
collected on expiry, so the only reads are `GET /origins` for `zitadel status`
and a delete for retiring one early — which is what `zitadel origins rm` calls.

### Why the allowlist is not in `zitadel.json`

One repository addresses several projects — a local one, a staging one, a
production one — and each needs a different list. `https://app.acme.com` belongs
to the production project and `http://localhost:3000` to the local one. Syncing
one shared file into all of them would grant every project every origin, which is
the opposite of what an allowlist is for.

**A committed file could only be per-project if it keyed on something the server
also knows, and it has nothing to key on.** A stage name is a client-side label
the server never sees, and
[CI has no stage at all](5-cli-stages.md#in-ci-there-are-no-files-and-no-stage-either),
so `{"origins": {"production": [...]}}` keys on a word that does not exist in the
job that would apply it. Keying by project id instead does work mechanically —
the CLI resolves the id from the environment and looks up that block — at the
cost of committing a map of project ids that goes stale on a fork and has to be
edited to add a stage, which is the one thing adding a stage needs no commit for
today.

So the allowlist stays where its subject is: on the project, changed by an
explicit call.

| | **In the file** | **On the project** |
|---|---|---|
| Changed by | `deploy`, as a side effect of shipping | `zitadel allowlist add`, a call of its own |
| Guarded by | review of the block, in a PR | `project.write`, plus the class and anchor rules, recorded in the audit log |
| Costs | a carve-out in the `zitadel status` drift hash, or an allowlist edit reads as undeployed code | nothing — `zitadel.json` holds release content only |
| Reconstructible from the repo | yes | no |

**And the review the file buys is weaker than it looks.** A block that CI applies
with the project secret is reviewed only as well as the branch protection on it,
and a branch that wants to widen the allowlist can call the endpoint directly
rather than bother editing a file — which is the admission the
[`preview` section](4-cli-commands.md#preview-must-not-be-able-to-widen-the-allowlist)
has to make anyway. Server-side rules hold whoever the caller is: a `production`
project refuses a wildcard primary and a loopback origin, and a wildcard preview
must be tenant-anchored.

The cost is real. The list is no longer reconstructible from the repository, and
bringing up a second project means running a command rather than inheriting a
file. `zitadel allowlist` printing the list with the check each pattern passed is
the mitigation; a declarative file that is *not* `zitadel.json` is
[Open 8](#open).

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

Five rules:

1. **Rows are never mutated, and nothing points at them.** Deploy, rollback and
   redeploy all append. What a target serves is the newest row carrying it — not
   a column that has to be moved in step.
2. **`deployments.origin` is a plain string, not a foreign key.** A preview
   origin can be collected and its history stays. A cascade would delete the
   audit trail of every expired preview.
3. **A release referenced by any deployment row is never collected.** Only
   never-deployed releases are collectable, so the newest row for a target can
   never name a release that has gone.
4. **Point-in-time is a query, not a column.** "What was `app.acme.com` serving
   on 1 October" is the newest row for that origin with
   `deployed_at <= '2026-10-01'`. No `superseded_at`, no validity ranges.
5. **Only a deploy to the project default may append an `origin = ""` row.** A
   `preview` deploy writes its own origin and nothing else. This is the invariant
   the no-`Origin` path rests on: were a preview allowed to write the default
   row, every server-side caller would start serving a branch. The CLI enforces
   it by having [two verbs](4-cli-commands.md#zitadel-preview), but it has to hold server-side
   too, because the CLI is not the only client.

### Why there is no pointer column

Today `environments.current_deployment_id` holds the live deployment, and the
migration gives two reasons: reads are one row, and the optimistic-concurrency
check is one compare. It carries no foreign key, because one would be circular
with the environment cascade (`000024_deployments.sql`).

Neither reason survives the move to origins.

**It saves no read on the hot path.** Resolution needs the release, not the
deployment id. With a pointer: read the origin row, read the deployment it names,
read the release. Without: read the origin row, seek the newest deployment for
that origin, read the release. Three accesses either way — the seek replaces the
id lookup. And the index that makes the seek a single-row hit is already in the
schema for the history list, `(project_id, origin, deployed_at DESC, id DESC)`.

**"Newest row per group" is already an idiom here.** The latest-revision
anti-join exists in all three dialects for schemas and flow definitions
(`internal/storage/dialect/*/json_schema.go`), so deriving the live deployment
reuses a pattern rather than introducing one.

**Concurrency has a better anchor.** The compare-one-column trick needs a column,
but the origin row still exists — it holds `kind` and `expires_at` — so a deploy
locks that row, reads the newest deployment, compares it against
`expected_deployment_id`, and inserts. The project row anchors the `origin = ""`
default the same way.

What dropping it buys:

- **The model becomes append-only in fact, not just in description.** A deploy
  touching five origins is five inserts and zero updates. There is no window in
  which a pointer has moved and its row is missing, or the reverse.
- **No unconstrainable state.** The column could never carry a foreign key, so
  nothing but application code kept it true. Derivation cannot drift.
- **Preview collection stays trivial.** Deleting an origin row removes a live URL
  and touches no pointer, which is already why `deployments.origin` is not a
  foreign key.

The price is that "what is live on all 40 origins" is a latest-per-group query
instead of 40 column reads. That is one anti-join, in a shape the dialects
already implement.

### How one deploy writes several rows

A deploy is one operation against several targets, and the rows it writes share
a `deploy_id` and a single `deployed_at` stamped once for the whole transaction.
It is all-or-nothing: a partial deploy that moved two origins and not the third
is the one outcome worth ruling out at the storage level.

The request names targets rather than origins one at a time:

```http
POST /deployments HTTP/1.1
Authorization: Bearer sk_proj_9f2Hx8LqT4vRmYpN2wCbVa

{
  "release": "sha256:4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b",
  "targets": ["default", "primary"],
  "reason":  "deploy",
  "message": "add phone_number to human-user"
}
```

A target is `"default"`, the keyword `"primary"`, or an exact origin. `"primary"`
expands server-side to the project's `primary` entries, so CI does not have to
read the project first to know what production is. The response lists what it
expanded to, and the rows carry it permanently — `GROUP BY deploy_id` reconstructs
the blast radius of any past deploy.

A `preview` run is the same call with one exact origin and a `ttl`, which is why
it can be authorised by the narrower preview credential: a request that names
`default` or `primary` requires the project secret.

**The fan-out is small by construction.** A `primary` entry on a `production`
project may not be a wildcard, so the primaries are exact URLs already and
expansion is a list read, not a match. Previews are never fanned out — each is
written by its own `preview` run. A realistic `deploy` writes two to five rows.

#### Why not one row holding several origins

Because `deployments` is on the read path now. "What does `app.acme.com` serve"
has to be a seek on `(project_id, origin, deployed_at DESC)`; against a row
holding `origins: [...]` it becomes an array-containment predicate, which needs a
different index in each of the three dialects and takes the history list out of
the keyset-pagination shape the rest of the repo uses. Per-origin rollback would
also stop being an append and start being a row rewrite.

The duplication is real but it is the cheap kind: the repeated columns are a
digest and a timestamp, and they buy a uniform `newest row for this key` rule
that both resolution and history read the same way.

#### Why not a group of origins

Because a named, addressable group of origins that share a release, a variable
scope and a current deployment is an environment. Giving it a different word
would reintroduce the thing this note removes, along with naming it, listing it,
seeding it and keeping membership in sync with the allowlist.

Origins are already grouped, by the allowlist pattern that admitted them, and
that grouping stays at the request layer: a deploy names a selector, the server
expands it, and storage stays one row per target. Nothing has to hold a
membership list, because membership is recomputed from the patterns every time it
is needed.

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
but not joined to it. If that matters, the fix is a nullable `target_id` joining
the origins that are "the same place over time" — a different grouping from the
one [ruled out above](#why-not-a-group-of-origins), which was a set of origins
sharing a release. This one groups a single target's successive names, carries no
release and no variables, and is worth adding only when something concrete
demands it.

## Variables

Two mechanisms, kept apart on purpose. Most of the confusion in this area comes
from one thing trying to be both.

| | **The store** | **The snapshot** |
|---|---|---|
| Table | `variables` | `deployment_variables` |
| Keyed by | `(project_id, name)` | `(project_id, deployment_id, name)` |
| Written by | a person, when they decide a value | a deploy, in the same transaction as the deployment row |
| Changes later | yes, that is its job | never |
| Read by | the next deploy | every request |

The store is a flat list of names on the project. There is no scope, no pattern,
no level and no inheritance — **a name has one stored value.** Targeting lives in
the deploy, because the snapshot already records what each target runs and a
second targeting mechanism in the store would answer the same question twice,
with the two free to disagree.

### Why a snapshot and not just the store

**Rollback would otherwise lie.** It restores the release and not the values, so
rolling back to a release that needed last month's IdP client would get this
month's. Rolling back to a *deployment* restores the pair that was running.

**And a value edit mid sign-in would reshape an attempt underway** — the hazard
[sealing](2-release-resolution.md#the-three-layers) already removes for resources, and which variables share
until they are frozen too.

A smaller gain: resolution reads one key instead of deciding anything, so there
is no resolution logic left on the hot path to get wrong.

### Setting one

```
$ zitadel variables set GOOGLE_CLIENT_ID prod-abc.apps.googleusercontent.com
stored. not live until the next deploy.

$ zitadel variables set GOOGLE_CLIENT_SECRET --secret
value: ********
stored as svs_01KB3F8N2P9S5WQX. not live until the next deploy.
```

```
$ zitadel variables list
NAME                          TYPE    STORED
GOOGLE_CLIENT_ID              value   prod-abc.apps.googleu…
GOOGLE_CLIENT_SECRET          secret  svs_01KB…  (set 10-02)
GOOGLE_CLIENT_ID_PREVIEW      value   preview-xyz.apps.goog…
GOOGLE_CLIENT_SECRET_PREVIEW  secret  svs_01KB…  (set 09-14)
```

One list, one value each, and the only question it answers is "what is stored".
What is *running* is a different question with a different answer per target, so
it is a different command:

```
$ zitadel variables resolve --origin https://acme-git-sso-acmeinc.vercel.app
serving dep_01KB3F8N2P9S5WQZ   deployed 10-02 14:10

NAME                  SERVING NOW                FROM
GOOGLE_CLIENT_ID      preview-xyz.apps.goog…     bound to GOOGLE_CLIENT_ID_PREVIEW
GOOGLE_CLIENT_SECRET  svs_01KB…                  bound to GOOGLE_CLIENT_SECRET_PREVIEW
SUPPORT_EMAIL         help@acme.com              store

  SUPPORT_EMAIL changed in the store since this deployment — deploy to apply
```

### How a preview gets different values

A preview on a production project still has to use a different IdP client than
production. That difference is a property of **the deploy**, not of the project:
the pipeline that creates previews is the thing that knows a preview is being
created.

So the deploy binds a name to a different stored name:

```yaml
- run: zitadel preview --ttl 7d
         --bind GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID_PREVIEW
         --bind GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET_PREVIEW
```

The snapshot then holds the preview values under the names the release asks for,
and `app.acme.com` keeps serving the production ones. Same release, same project,
different credentials — which was the requirement.

**A binding names a variable; it never carries a value.** That is what lets the
narrow preview credential of [Prerequisites](4-cli-commands.md#prerequisites) be allowed to bind
at all: resolving `GOOGLE_CLIENT_SECRET_PREVIEW` happens server-side, so CI never
holds the secret and a leaked pipeline token reveals no values. A literal
override is also allowed for genuinely per-branch things, and only for
non-secrets:

```
zitadel preview --ttl 7d --var FEATURE_NEW_CONSENT=true
```

**What this costs.** The preview mapping lives in the workflow file and is
repeated in every pipeline that deploys previews, where a pattern scope would
have stored it once. The trade is deliberate: one authoring model instead of two,
the mapping visible in a reviewed file next to the job that uses it, and no
server-side rule that silently applies to a class of origins nobody is looking
at. If several pipelines end up repeating the same bindings, that is the signal
to reconsider — not before.

### Immutability at runtime

Four properties, each from a different part of the model:

1. **Snapshot rows are written once**, in the transaction that writes the
   deployment, and never updated. A deployment is never a partially-rewritten
   value set.
2. **Editing the store cannot reach a snapshot.** Different table, no shared row,
   no cascade. `zitadel variables set` during a sign-in changes nothing that
   sign-in can see.
3. **A flow seals the deployment id, not the release digest.** One pointer pins
   the resources *and* the values, so the two cannot drift apart mid-attempt.
   This replaces sealing the release, and is strictly stronger.
4. **Secret versions are immutable.** A rotation mints a new version; the old one
   keeps its bytes for as long as a deployment references it. Revocation is the
   single exception and it fails closed — a revoked version refuses, rather than
   quietly resolving to a newer one.

### Why not one table with a null deployment id

The shape is tempting — `variables(project_id, deployment_id, name, …)` where a
null or empty `deployment_id` is the store and a real one is a snapshot row. It
is also the pattern this table already uses for environments today, and the scar
tissue is visible: `000008_variables.sql` carries a generated column,
`environment_ref AS NULLIF(environment_id, '')`, for no reason other than that a
composite foreign key is skipped when a column is null, so the project-level rows
can opt out of a constraint the scoped rows are held to. Mixing two meanings in
one column is what forced that.

**The sentinel pattern pays off when a read has to fall back from the specific to
the general in one query.** That is what it was doing for environments, and it is
exactly what this design no longer needs: a deploy freezes every name, so the
snapshot is complete and a request reads snapshot rows only. No union, no
`COALESCE`, no fallback. The benefit is gone and the costs are not:

- **Immutability stops being structural.** "Snapshot rows are never updated"
  becomes "rows where `deployment_id` is not null are never updated" — an
  invariant for application code or a trigger to keep, rather than one the schema
  makes true. Two tables give the snapshot no update path at all. This is the
  same objection that removed
  [`current_deployment_id`](#why-there-is-no-pointer-column): a rule nothing but
  code enforces is a rule that eventually is not true.
- **The wrong query leaks.** `zitadel variables list` becomes a filtered read
  that must never forget its filter; forget it once and the listing shows every
  historical value of every deployment, including superseded secret references.
  Separate tables make that mistake unexpressible instead of merely unlikely.
- **Half the columns would be null half the time.** The store holds `is_secret`
  and `modified_at`, which a frozen row has no use for; the snapshot holds
  `secret_version`, which a store row does not pin. They are different records
  that happen to share a name column.
- **The lifecycles have nothing in common.** The store is tens of rows a person
  curates and edits. The snapshot is tens of rows per deployment, append-only,
  retained as long as the deployment is readable and collected with it.

A third shape — store each distinct value once and have deployments reference a
value id — removes duplication but puts a join on the request path to save
copying short strings. Secrets are already references, so the only thing it
would dedup is plaintext. Not worth the join.

### Why the snapshot is a table and not a document

The deployment row already carries a `metadata` document, so a variables
document would have been idiomatic. But rotation needs the reverse lookup:
*which deployments still reference `svs_01KB…`*, so the old version can be
revoked once nothing serves it. That is a query by secret version, which a table
indexes and a JSON column in three dialects does not.

### What this changes elsewhere

- **`createDeployment`'s idempotency key moves.** It answers `200` and writes
  nothing today when the named release is already running. The key has to become
  the release *and* the resolved value set, or a deploy whose only purpose is a
  changed variable would be silently discarded.
- **A deploy may carry only a variable change.** Same release, new deployment
  row, so the history shows one digest twice with different snapshots. That is
  the fix for a wrong value: a deploy, not an edit — see [Open 6](#open).
- **Variables never move onto the release.** The same release has to run with
  different values on different origins, which is the preview case above.
  Pinning them to the release would make that impossible.

## Promotion

CI posts the same content to the staging project and then the production project
and asserts the two digests match. If they differ, the content differed and the
deploy fails.

This needs a digest computed over resource **content** rather than over revision
ids, since revision ids are per-project. A content digest is reproducible across
projects; a pointer digest is not.

`zitadel promote` has no server surface: it is `deploy` against the other target
with a digest assertion.

## Prerequisites

Two things in this document need work that does not exist yet.

- **A working origin matcher and a preview-host registry.** Matching is exact
  string equality today, so wildcard patterns match nothing at all.
- **RP ID as a project setting**, or own-domain previews cannot use production
  passkeys.

## Open

1. **Content digest or pointer digest on the wire.** A content digest is
   reproducible across projects, which is what makes promotion checkable; a
   pointer digest is unguessable, which matters on the fallback-header path.
   Keeping both — pointer digest on the wire, content digest for CI assertions —
   is probably the answer.
2. **How strictly a concurrent deploy to one target must serialise.** With no
   pointer column, two appends both succeed and the later timestamp wins. Taking
   a row lock on the target and checking `expected_deployment_id` makes the
   conflict explicit; last-write-wins is cheaper and may be enough for a target
   only CI writes to.
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
6. **Whether a variable-only deploy should be a distinct `reason`.** Reusing
   `deploy` keeps the enum small but makes "the release did not change here"
   something a reader has to notice from the digest rather than read.
7. **Whether `production` should require a claimed project** (this note says
   yes), and whether anything else currently claim-gated should move onto the
   class.
8. **A declarative per-project file.** `zitadel apply project.yaml` — one file
   per project rather than one shared across stages, outside the release bundle,
   never applied by a preview job — would restore review and reconstructibility
   without the keying problem above. It wants the whole-list `PUT`, and a
   `--project` it checks against the file rather than trusting the environment.
   Worth doing only once someone has more patterns than they can hold in their
   head.
