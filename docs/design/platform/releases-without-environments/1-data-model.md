# Data Model

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

The storage shape. A deployment is one operation over a set of targets, each
an origin string instead of an environment id, and the newest deployment to a
target is what that target serves.
Which URLs are allowed at all is [origins](2-origins.md); the values a
deployment carries are [variables](4-variables.md).

## Entities

Field names are proposals, not settled wire contracts. Most of these tables
already exist — what changes is the axis they are keyed on.

| Entity | Old Model | New Model |
|---|---|---|
| **Project** | `projects` | kept — `preview_origins` becomes `origins` with a `kind` per entry, plus `mode` and `publishable_key` |
| **Preview** | — | **new table**, one row per live *preview* URL, with an expiry. The preview is what admits requests from that URL. Not a routing index, and a primary hostname gets none |
| **Environment** | `environments`, seeded per project | **dropped** |
| **Deployment** | `deployments`, keyed to an environment | kept as the operation — `environment_id` goes, the targets move to a table of their own. The newest target row **is** the pointer; `environments.current_deployment_id` is not carried over |
| **Deployment target** | — | **new table**, one row per origin a deployment covered. What a target serves is its newest row |
| **Release** | `releases` | shape kept — `content_hash` becomes the wire identifier, `revoked_at` is new |
| **Variable** | `variables`, scoped by `environment_id` | kept, the scope column dropped — see [variables](4-variables.md) |
| **Deployment variable** | — | **new table**, the immutable snapshot one deployment runs — see [variables](4-variables.md) |

### Project

```jsonc
{
  "id": "prj_01K9AA9M3K7E2QX8VB4T",
  "name": "acme",

  "mode": "production",                           // NEW - see 2-origins.md
  // NEW - ADR 036 defines the credential; internal/ has none, and the `pk_`
  // spelling here is illustrative since no ADR fixes a format for it.
  "publishable_key": "pk_7kR2pXq9vN3wLmYhT4cB8A",

  // CHANGED - today `preview_origins` is a flat list of exact strings
  // (internal/domain/project.go:68) compared with `allowed == originStr`
  // (internal/api/flow.go:386), serving only the preview secret. Now patterns,
  // each carrying a `kind`. A `primary` pattern admits requests; a `preview`
  // pattern says which URLs the preview credential may register. Neither
  // routes.
  "origins": [
    { "pattern": "https://app.acme.com",         "kind": "primary" },
    { "pattern": "https://*-acmeinc.vercel.app", "kind": "preview" }
  ],

  // NOT CARRIED OVER - `environments.current_deployment_id` has no counterpart.
  // What a target serves is the newest deployment target row for it; the
  // project default is the newest row with origin "". See Why there is no
  // pointer column.
  "created_at": "2026-04-21T14:03:11Z"
}
```

### Preview

One row per live preview URL, keyed `(project_id, origin)`. Exact strings, no
patterns. The preview says the URL is allowed and still live; it never says
what the URL serves.

```jsonc
// NEW TABLE `previews` - one row per live preview URL and nothing else, keyed
// by an exact origin string and carrying an expiry rather than a pointer.
{
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "origin":     "https://acme-git-sso-acmeinc.vercel.app",
  "expires_at": "2026-10-09T14:10:00Z", // renewed by deploying to it again
  "created_at": "2026-10-02T14:10:00Z"
}
```

A platform mints more than one URL for a deployment — a branch-stable one and
a per-deployment one, and the per-deployment one is what its bot comment and
dashboard link to. So one `zitadel preview` run writes one preview per URL the
platform reports, all with the same expiry, and the deployment's targets carry
each of them. Two previews per push is the usual count; see
[origin resolution](6-cli-commands.md#zitadel-preview).

**The preview is what admits its URL.** A request from a URL that matches a
`preview` pattern but has no live preview is refused, exactly as if it matched
nothing. The pattern constrains what the preview credential may write; it
admits no request by itself. That is what makes a wildcard on a shared host
safe to hold even where the host lets a stranger mint a hostname that matches
it — [what a wildcard on a shared host is worth](2-origins.md#what-a-wildcard-on-a-shared-host-is-worth).

It is also why the expiry has a table of its own rather than a column on the
deployment target. Admission wants one row per live URL to look up and to
sweep, not a newest-per-origin scan, and retiring a URL early is deleting that
preview — not appending a deployment that names no release.

#### Why a primary hostname has no row

`https://app.acme.com` is routed by the newest deployment target carrying it,
so a row of its own would hold only the string already in that column. Every
other field is empty or lives elsewhere: a primary never expires, and the
[kind](2-origins.md#why-a-pattern-has-a-kind) belongs to the pattern that
allowed the URL, which is held on the project.

- **The project default already proves a target needs no row.** `origin = ""` is
  a routing target with no entry anywhere, so which targets exist is already the
  deployment history's question to answer.
- **A row could only ever appear after a deploy to it** — nothing registers a
  primary in advance — so the set of primary rows and `DISTINCT origin` over the
  deployment targets are the same set, maintained twice.
- **Layer 2 gets shorter.** The newest deployment target for the origin, then
  the release, instead of the row, the deployment and the release.
- **Retiring a primary is removing its pattern.** A primary pattern is a
  literal, so deleting it takes exactly one hostname out of service. A preview
  pattern is a wildcard covering every URL the platform will ever mint, so
  deleting it would retire hundreds that are still wanted. That asymmetry is the
  reason previews need a per-URL row and primaries do not.

What the preview is left holding is an expiry — exactly what a preview needs
and a primary has no use for — and something `zitadel preview rm` can delete to
retire one URL early.

So `environments` is **dropped**: the table and its unique name index
(`000005_environments.sql`), `seedDefaultEnvironments`
(`internal/service/project.go:173`), the `/environments` and
`/environments/{name}` paths, and the `environment.read` scope.

### Deployment

The operation: one release, one set of targets, one transaction. Immutable,
append-only.

```jsonc
{
  "id":         "dep_01KB3F8N2P9S5WQY",
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",

  // UNCHANGED as a field - `release_id` points at `releases.id`, never at the
  // digest. What changes is the constraint: the foreign key cascades today, so
  // deleting a release deletes its deployments. It must restrict.
  "release_id": "rel_01KB3F8N2P9S5WQV",

  // CHANGED - today `environment_id`, a composite foreign key to `environments`
  // that cascades on delete (000011_deployments.sql). Now the origins this
  // deployment covered, one target row each, "" = the project default.
  // Deliberate - see Deployment history.
  "targets": [
    { "origin": "https://acme-git-sso-acmeinc.vercel.app", "expires_at": "2026-10-09T14:10:00Z" },
    { "origin": "https://acme-k3x9v2-acmeinc.vercel.app",  "expires_at": "2026-10-09T14:10:00Z" }
  ],

  // The variables this deployment runs are the `deployment_variables` rows
  // carrying its id - written in this same transaction, never updated.

  // These three already exist, inside the `metadata` document. Flat here for
  // readability only.
  "reason":      "deploy",
  "message":     "add phone_number to human-user",
  "deployed_by": "user_01K8ZQ3K7E5M2P9S",

  // NEW, also in `metadata` - on a rollback, the deployment it reversed, so
  // the trail reads forwards and backwards.
  "rollback_of": null,

  "deployed_at": "2026-10-02T14:10:00Z"

  // DROPPED - metadata's `source_environment_id` and `source_environment_name`.
  // A promotion source is an origin now, so those are replaced, not renamed.
}
```

### Deployment target

One row per origin a deployment covered, in `deployment_targets`, keyed
`(project_id, deployment_id, origin)` and carrying no id of its own. `origin`
is the history axis, and the **empty string means the project default** — what
a caller with no `Origin` gets.

```jsonc
{
  "project_id":    "prj_01K9AA9M3K7E2QX8VB4T",
  "deployment_id": "dep_01KB3F8N2P9S5WQY",
  "origin":        "https://acme-git-sso-acmeinc.vercel.app",

  // Copied from the deployment so the seek below stays on one table.
  "release_id":    "rel_01KB3F8N2P9S5WQV",
  "deployed_at":   "2026-10-02T14:10:00Z"
}
```

`expires_at` on the wire is not a column here: it is the preview's expiry,
joined in for the live view and only for a preview URL.

### Release

```jsonc
{
  // CHANGED - not the column, its job. `content_hash` is already the dedup key;
  // here it is also the identifier on the wire.
  "content_hash": "9f2c1a7b4e83d05f6c2b19ae7d430f821c6b5de90a4f7382",

  // UNCHANGED from here down - pointers, metadata and the actor fields are
  // exactly what `releases` already stores.
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "pointers": [
    { "kind": "schema",          "handle": "human-user",    "revision_id": "sch_01KWHF18816ZQE" },
    { "kind": "flow_definition", "handle": "default-login", "revision_id": "flowdef_01KWHG09JXA" }
  ],
  "metadata": {
    "message":    "add phone_number to human-user",
    "git_sha":    "4a5b6c7d8e9f0a1b2c3d",
    "created_by": "user_01K8ZQ3K7E5M2P9S"
  },

  "revoked_at": null // NEW - see below
}
```

`revoked_at` is the operator's hard stop. A revoked release is refused on every
path, including a client that [pins it](3-release-resolution.md#pinning-a-release),
so a release found to be dangerous can be taken out from under every bundle
that baked its digest in, at the cost of breaking those bundles until they are
rebuilt. Rolling back is the soft version — it moves what targets serve and
leaves pinned clients where they are.

`content_hash` is a SHA-256 over the sorted pointer set with metadata excluded,
and it is the identifier on the wire. The column is 64 bare hex characters —
`chk_releases_content_hash` checks exactly that — so the `sha256:` prefix used
throughout these documents is a wire form, stripped at the edge rather than
stored. A minted `rel_<ULID>` stays the storage primary key; short forms are
accepted down to 12 hex characters, and ambiguity is refused.
Posting the same content twice returns the same release — current behaviour, not
a proposal: the unique index on `(project_id, content_hash)` already enforces it
(`000007_releases.sql`).

## Deployment history

History is the set of deployment targets naming an origin, newest first.

```sql
SELECT * FROM deployment_targets
 WHERE project_id = ? AND origin = 'https://app.acme.com' -- '' for the default
 ORDER BY deployed_at DESC, deployment_id DESC;
```

Supporting index: `(project_id, origin, deployed_at DESC, deployment_id DESC)`.

Five rules:

1. **Rows are never mutated, and nothing points at them.** Deploy, rollback and
   redeploy all append. What a target serves is the newest row carrying it, not
   a column that has to be moved in step.
2. **`deployment_targets.origin` is a plain string, not a foreign key**, so a
   collected preview keeps its history. A cascade would delete the audit trail
   of every expired preview.
3. **A release referenced by any deployment is never collected**, so the
   newest row for a target can never name a release that has gone.
4. **Point-in-time is a query, not a column** — the newest row for the origin
   with `deployed_at <= ?`. No `superseded_at`, no validity ranges.
5. **Only a deploy to the project default may append an `origin = ""` row.**
   Were a preview allowed to write it, every server-side caller would start
   serving a branch. The CLI enforces this with
   [two verbs](6-cli-commands.md#zitadel-preview); the server has to as well,
   because the CLI is not the only client.

### Why there is no pointer column

`environments.current_deployment_id` exists today for two stated reasons: reads
are one row, and the optimistic-concurrency check is one compare. It carries no
foreign key, because one would be circular with the environment cascade
(`000024_deployments.sql`). Neither reason survives the move to origins — and
the schema half-admits it already, since the history index carries the comment
"The first row under this order is the environment's current deployment".

- **It saves no read.** Resolution needs the release, not the deployment id.
  With a pointer: the row, the deployment it names, the release. Without: the
  newest deployment target for that origin, then the release — two accesses
  against three for a primary, which
  [has no row](#why-a-primary-hostname-has-no-row). The index that makes the
  seek a single-row hit is already in the schema for the history list.
- **"Newest row per group" is already an idiom here** — the latest-revision
  anti-join exists in all three dialects for schemas and flow definitions
  (`internal/storage/dialect/*/json_schema.go`).
- **Concurrency has a better anchor.** A preview run locks the preview it
  renews, compares the newest deployment against `expected_deployment_id`, and
  inserts. A `deploy` has no preview to lock, so it locks the project row —
  which matches its grain, since naming `primary` means every one of those
  origins moves or none does. Previews keep a lock per URL precisely where the
  concurrency is: one run per pull request, many at once, none of them waiting
  on a production deploy.

**And a pointer is the only thing that would make a primary row pay for
itself**, which is the argument the other way round. A row per origin carrying a
current deployment, and with it a variable scope and a name to call it by, is an
`environments` row keyed by a URL instead of by an `env_` id — the resource this
spike removes, re-created under a different primary key. Appending is what keeps
the two apart.

Dropping it makes the model append-only in fact rather than in description — a
deploy over five origins is one deployment and five target rows, zero updates —
and removes a column that could never carry a foreign key and so relied on
application code to stay true. The price is one latest-per-group query instead
of N column reads.

### How one deployment covers several targets

One transaction, all-or-nothing, with one deployment id and one `deployed_at`
for the whole set: a deploy that moved two origins and not the third is the
outcome worth ruling out at the storage level. The request names targets rather
than origins one at a time:

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
read the project first; the response is the deployment with its expanded
`targets`, which is the blast radius of that deploy, kept. A `preview` run is
the same call with its exact origins and a `ttl`, which is why the narrower
preview credential can authorise it — naming `default` or `primary` requires
the project secret.

```http
HTTP/1.1 201 Created

{
  "deployment": {
    "id": "dep_01KB3F8N2P9S5WQY",
    "release_id": "rel_01KB3F8N2P9S5WQV",
    "targets": [
      { "origin": "" },
      { "origin": "https://app.acme.com" },
      { "origin": "https://www.acme.com" }
    ],
    "metadata": { "reason": "deploy", "message": "add phone_number to human-user" },
    "deployed_at": "2026-10-01T17:02:00Z"
  },
  "warnings": []
}
```

**Fan-out is small by construction.** A `primary` entry on a project in
`production` mode may not be a wildcard, so expansion is a list read rather
than a match, and previews are never fanned out — each is written by its own
run. A realistic `deploy` covers two to five targets.

#### Why not one row holding several origins, or a group

A single row holding `origins: [...]` turns "what does `app.acme.com` serve"
from a seek on `(project_id, origin, deployed_at DESC)` into an
array-containment predicate — a different index in each of three dialects,
outside the keyset-pagination shape the rest of the repo uses — and per-origin
rollback stops being an append. The duplication it saves is a digest and a
timestamp per target row.

A named group of origins sharing a release, a variable set and a current
deployment **is an environment**, with the naming, listing, seeding and
membership upkeep to match. Origins are already grouped by the pattern that
allowed them, and that grouping stays at the request layer: a deploy names a
selector, the server expands it, storage keeps one row per target.

**The group a command needs is the deployment itself.** One target row per
origin does not mean one origin per operation. The rows a deploy wrote belong to
one deployment, and that is what
[`zitadel deployment rollback`](6-cli-commands.md#zitadel-deployment-rollback)
addresses — one call, one transaction, a target row appended per origin under a
new deployment of its own. A platform deployment with three domains attached to
it is one deployment with three targets here. What this design refuses is a
*named, long-lived* group carrying its own current deployment, because that is
an environment; an operation over immutable rows is not.

### Example

Deployment targets, newest first:

| `deployed_at` | `origin` | release (digest) | `reason` | deployment |
|---|---|---|---|---|
| 10-02 14:10 | `acme-git-sso…vercel.app` | `sha256:9f2c…` | `deploy` | `dep_…Y` |
| 10-02 09:30 | `` (default) | `sha256:4a5b…` | `rollback` | `dep_…W` |
| 10-02 09:30 | `app.acme.com` | `sha256:4a5b…` | `rollback` | `dep_…W` |
| 10-02 09:30 | `www.acme.com` | `sha256:4a5b…` | `rollback` | `dep_…W` |
| 10-01 17:02 | `` (default) | `sha256:c3f7…` | `deploy` | `dep_…V` |
| 10-01 17:02 | `app.acme.com` | `sha256:c3f7…` | `deploy` | `dep_…V` |
| 10-01 17:02 | `www.acme.com` | `sha256:c3f7…` | `deploy` | `dep_…V` |
| 09-28 11:44 | `acme-git-pw…vercel.app` | `sha256:81de…` | `deploy` | `dep_…U` |

The 17:02 release went bad and was rolled back at 09:30 across all three
primary targets in one operation: `dep_…V` went wrong, so `dep_…W` undid it,
three targets each. Undoing a deployment is itself a deployment. The 09-28
preview has since expired and is gone, yet its deployment target is still here.

**Known limitation.** A target's history is its hostname's, so renaming a
production hostname starts a new one. The fix, if it matters, is a nullable
`target_id` joining a single target's successive names — carrying no release and
no variables, and a different grouping from the one ruled out above.

## Promotion

CI posts the same content to the staging project and then the production project
and asserts the two digests match; if they differ, the content differed and the
deploy fails. That needs a digest computed over resource **content** rather than
over revision ids, which are per-project. `zitadel promote` has no server
surface — it is `deploy` against the other target with a digest assertion.

## Prerequisites

**Amendments to ADR 035 and ADR 036.** ADR 035 is built on environments as
runtime slots; ADR 036 issues publishable keys per environment and ties
allow-all to non-production environments. Both need a dated amendment pointing
at the mode and the origin, not a rewrite.

**The console.** Every environment screen goes with the entity. What replaces
it is the deployment log and the origins, which the
[CLI commands](6-cli-commands.md#zitadel-deployment) already describe.

## Open

1. **Content digest or pointer digest on the wire.** A content digest is
   reproducible across projects, which is what makes promotion checkable; a
   pointer digest is unguessable. Guessability no longer carries any security —
   a pin may only name a release
   [already deployed to the target](3-release-resolution.md#pinning-a-release),
   so a digest is not a capability — which leaves this a question of promotion
   ergonomics only. Keeping both — pointer digest on the wire, content digest
   for CI assertions — is probably the answer.
2. **How strictly a concurrent deploy to one target must serialise.** With no
   pointer column, two appends both succeed and the later timestamp wins. A
   lock — the project row for a primary, the preview for a preview URL — plus
   `expected_deployment_id` makes the conflict explicit; last-write-wins is
   cheaper and may be enough for a target only CI writes to.
3. **Release retention window, and what counts as "cold".** A last-resolved
   timestamp is a write on the hot path; an approximation avoids one.
