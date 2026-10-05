# Data Model

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

The storage shape. A deployment is keyed on an origin string instead of an
environment id, and the newest row for a target is what that target serves.
Which URLs are allowed at all is [origins](2-origins.md); the values a
deployment carries are [variables](4-variables.md).

## Entities

Field names are proposals, not settled wire contracts. Most of these tables
already exist — what changes is the axis they are keyed on.

| Entity | Old Model | New Model |
|---|---|---|
| **Project** | `projects` | kept — `preview_origins` becomes `allowed_origins` with a `kind` per entry, plus `class` and `publishable_key` |
| **Origin** | — | **new table**, one row per live *preview* URL, with an expiry. Not a routing index, and a primary hostname gets no row |
| **Environment** | `environments`, seeded per project | **dropped** |
| **Deployment** | `deployments`, keyed to an environment | kept — `environment_id` becomes a plain `origin` string, plus `deploy_id`. The newest row **is** the pointer; `environments.current_deployment_id` is not carried over |
| **Release** | `releases` | shape kept — `content_hash` becomes the wire identifier, `revoked_at` is new |
| **Variable** | `variables`, scoped by `environment_id` | kept, the scope column dropped — see [variables](4-variables.md) |
| **Deployment variable** | — | **new table**, the immutable snapshot one deployment runs — see [variables](4-variables.md) |

### Project

```jsonc
{
  "id": "prj_01K9AA9M3K7E2QX8VB4T",
  "name": "acme",

  "class": "production",                          // NEW - see 2-origins.md
  // NEW - ADR 036 defines the credential; internal/ has none, and the `pk_`
  // spelling here is illustrative since no ADR fixes a format for it.
  "publishable_key": "pk_7kR2pXq9vN3wLmYhT4cB8A",

  // CHANGED - today `preview_origins` is a flat list of exact strings
  // (internal/domain/project.go:68) compared with `allowed == originStr`
  // (internal/api/flow.go:386), serving only the preview secret. Now patterns,
  // each carrying a `kind`. They authorize; they never route.
  "allowed_origins": [
    { "pattern": "https://app.acme.com",         "kind": "primary" },
    { "pattern": "https://*-acmeinc.vercel.app", "kind": "preview" }
  ],

  // NOT CARRIED OVER - `environments.current_deployment_id` has no counterpart.
  // What a target serves is the newest deployment row for it; the project
  // default is the newest row with origin "". See Why there is no pointer column.
  "created_at": "2026-04-21T14:03:11Z"
}
```

### Origin

One row per live preview URL, keyed `(project_id, origin)`. Exact strings, no
patterns. The row says the URL is still live; it never says what the URL
serves.

```jsonc
// NEW TABLE - one row per live preview URL and nothing else, keyed by an exact
// origin string and carrying an expiry rather than a pointer.
{
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",
  "origin":     "https://acme-git-sso-acmeinc.vercel.app",
  "expires_at": "2026-10-09T14:10:00Z", // renewed by deploying to it again
  "created_at": "2026-10-02T14:10:00Z"
}
```

#### Why a primary hostname has no row

`https://app.acme.com` is routed by the newest deployment row carrying it, so a
row of its own would hold only the string already in that column. Every other
field is empty or lives elsewhere: a primary never expires, and the
[kind](2-origins.md#why-a-pattern-has-a-kind) belongs to the pattern that
allowed the URL, which is held on the project.

- **The project default already proves a target needs no row.** `origin = ""` is
  a routing target with no entry anywhere, so which targets exist is already the
  deployment history's question to answer.
- **A row could only ever appear after a deploy to it** — nothing registers a
  primary in advance — so the set of primary rows and `DISTINCT origin` over the
  deployments are the same set, maintained twice.
- **Layer 2 gets shorter.** The newest deployment for the origin, then the
  release, instead of the row, the deployment and the release.
- **Retiring a primary is removing its pattern.** A primary pattern is a
  literal, so deleting it takes exactly one hostname out of service. A preview
  pattern is a wildcard covering every URL the platform will ever mint, so
  deleting it would retire hundreds that are still wanted. That asymmetry is the
  reason previews need a per-URL row and primaries do not.

What the row is left holding is an expiry — exactly what a preview needs and a
primary has no use for — and something `zitadel origins rm` can delete to retire
one URL early.

So `environments` is **dropped**: the table and its unique name index
(`000005_environments.sql`), `seedDefaultEnvironments`
(`internal/service/project.go:173`), the `/environments` and
`/environments/{name}` paths, and the `environment.read` scope.

### Deployment

Immutable, append-only.

```jsonc
{
  "id":         "dep_01KB3F8N2P9S5WQZ",
  "project_id": "prj_01K9AA9M3K7E2QX8VB4T",

  // NEW - correlates the rows one deploy wrote. `dpl` is not in ADR 047's
  // prefix registry; see Prerequisites.
  "deploy_id": "dpl_01KB3F8N2P9S5WQY",

  // CHANGED - today `environment_id`, a composite foreign key to `environments`
  // that cascades on delete (000011_deployments.sql). Now a plain string, no
  // foreign key, "" = the project default. Deliberate - see Deployment history.
  "origin": "https://acme-git-sso-acmeinc.vercel.app",

  // UNCHANGED as a field - `release_id` points at `releases.id`, never at the
  // digest. What changes is the constraint: the foreign key cascades today, so
  // deleting a release deletes its deployments. It must restrict.
  "release_id": "rel_01KB3F8N2P9S5WQV",

  // The variables this deployment runs are the `deployment_variables` rows
  // carrying its id - written in this same transaction, never updated.

  // These three already exist, inside the `metadata` document. Flat here for
  // readability only.
  "reason":      "deploy",
  "message":     "add phone_number to human-user",
  "deployed_by": "user_01K8ZQ3K7E5M2P9S",

  "deployed_at": "2026-10-02T14:10:00Z"

  // DROPPED - metadata's `source_environment_id` and `source_environment_name`.
  // A promotion source is an origin now, so those are replaced, not renamed.
}
```

`origin` is the history axis, and the **empty string means the project
default** — what a caller with no `Origin` gets.

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

  "revoked_at": null // NEW
}
```

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

History is the set of deployment rows naming a target, newest first.

```sql
SELECT * FROM deployments
 WHERE project_id = ? AND origin = 'https://app.acme.com' -- '' for the default
 ORDER BY deployed_at DESC, id DESC;
```

Supporting index: `(project_id, origin, deployed_at DESC, id DESC)`.

Five rules:

1. **Rows are never mutated, and nothing points at them.** Deploy, rollback and
   redeploy all append. What a target serves is the newest row carrying it, not
   a column that has to be moved in step.
2. **`deployments.origin` is a plain string, not a foreign key**, so a collected
   preview origin keeps its history. A cascade would delete the audit trail of
   every expired preview.
3. **A release referenced by any deployment row is never collected**, so the
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
  newest deployment for that origin, then the release — two accesses against
  three for a primary, which [has no row](#why-a-primary-hostname-has-no-row).
  The index that makes the seek a single-row hit is already in the schema for
  the history list.
- **"Newest row per group" is already an idiom here** — the latest-revision
  anti-join exists in all three dialects for schemas and flow definitions
  (`internal/storage/dialect/*/json_schema.go`).
- **Concurrency has a better anchor.** A preview run locks the row it
  renews, compares the newest deployment against `expected_deployment_id`, and
  inserts. A `deploy` has no row to lock, so it locks the project row — which
  matches its grain, since naming `primary` means every one of those origins
  moves or none does. Previews keep a lock per row precisely where the
  concurrency is: one run per pull request, many at once, none of them waiting
  on a production deploy.

**And a pointer is the only thing that would make a primary row pay for
itself**, which is the argument the other way round. An origin row carrying a
current deployment, and with it a variable scope and a name to call it by, is an
`environments` row keyed by a URL instead of by an `env_` id — the resource this
spike removes, re-created under a different primary key. Appending is what keeps
the two apart.

Dropping it makes the model append-only in fact rather than in description — a
deploy over five origins is five inserts and zero updates — and removes a column
that could never carry a foreign key and so relied on application code to stay
true. The price is one latest-per-group query instead of N column reads.

### How one deploy writes several rows

One transaction, all-or-nothing, with one `deploy_id` and one `deployed_at` for
the whole set: a deploy that moved two origins and not the third is the outcome
worth ruling out at the storage level. The request names targets rather than
origins one at a time:

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
read the project first; the response lists the expansion, and
`GROUP BY deploy_id` reconstructs the blast radius of any past deploy. A
`preview` run is the same call with one exact origin and a `ttl`, which is why
the narrower preview credential can authorise it — naming `default` or `primary`
requires the project secret.

**Fan-out is small by construction.** A `primary` entry on a `production`
project may not be a wildcard, so expansion is a list read rather than a match,
and previews are never fanned out — each is written by its own run. A realistic
`deploy` writes two to five rows.

#### Why not one row holding several origins, or a group

A row holding `origins: [...]` turns "what does `app.acme.com` serve" from a seek
on `(project_id, origin, deployed_at DESC)` into an array-containment predicate —
a different index in each of three dialects, outside the keyset-pagination shape
the rest of the repo uses — and per-origin rollback stops being an append. The
duplication it saves is a digest and a timestamp per row.

A named group of origins sharing a release, a variable set and a current
deployment **is an environment**, with the naming, listing, seeding and
membership upkeep to match. Origins are already grouped by the pattern that
allowed them, and that grouping stays at the request layer: a deploy names a
selector, the server expands it, storage keeps one row per target.

### Example

| `deployed_at` | `origin` | release (digest) | `reason` | `deploy_id` |
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
its row is gone, yet its deployment row is still here.

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

**A `dpl` prefix registered by an amendment to ADR 047**, for the deploy
correlation id. The registry holds `rel` and `dep` but nothing for the set of
rows one deploy wrote, and the ADR is explicit that prefixes are not added
without going through it.

## Open

1. **Content digest or pointer digest on the wire.** A content digest is
   reproducible across projects, which is what makes promotion checkable; a
   pointer digest is unguessable, which matters on the fallback-header path.
   Keeping both — pointer digest on the wire, content digest for CI assertions —
   is probably the answer.
2. **How strictly a concurrent deploy to one target must serialise.** With no
   pointer column, two appends both succeed and the later timestamp wins. A
   lock — the project row for a primary, the preview row for a preview — plus
   `expected_deployment_id` makes the conflict explicit; last-write-wins is
   cheaper and may be enough for a target only CI writes to.
3. **Release retention window, and what counts as "cold".** A last-resolved
   timestamp is a write on the hot path; an approximation avoids one.
4. **Whether the expiry belongs on the deployment rather than in its own
   table.** A preview deployment could carry its own `expires_at`, leaving no
   Origin table at all, and retiring a URL early would be an append, which is
   what rollback already is. Against it: whatever deletes expired URLs wants one
   row per live URL to read rather than a newest-per-origin scan, and a
   retirement row names no release, which weakens "a deployment names the
   release its target serves".
