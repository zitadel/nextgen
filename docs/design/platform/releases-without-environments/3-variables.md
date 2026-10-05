# Variables

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

**Variables and secrets**, not environment variables: these are values the
server resolves for a deployment and serves to a flow, and nothing puts them in
a process environment. The CLI calls them `vars`, leaving `env` to the
[client-side environment](7-cli-environments.md#environments-pointing-one-repository-at-several-projects).

Two mechanisms, kept apart on purpose. Most of the confusion in this area comes
from one thing trying to be both.

| | **The store** | **The snapshot** |
|---|---|---|
| Table | `variables` | `deployment_variables` |
| Keyed by | `(project_id, name, applies_to)` | `(project_id, deployment_id, name)` |
| Written by | a person, when they decide a value | a deploy, in the same transaction as the deployment row |
| Changes later | yes, that is its job | never |
| Read by | the next deploy | every request |

The store is a flat list of names on the project: no patterns, no levels, no
per-origin targeting. A name carries one value, plus **one optional override for
previews** — `applies_to` is `all` or `preview`, and there is no third value, so
two rows per name is the maximum.

That one axis exists because a preview on a production project must not hold the
production IdP client: the URL is reachable by anyone who can guess it, and the
whole point of the URL is that it is not production. It is one rule about one
kind of deploy, not a targeting mechanism — nothing addresses an origin, a
pattern or a branch.

```jsonc
// CHANGED - the `environment_id` column is removed rather than repurposed, and
// with it the generated `environment_ref` column, its foreign key and the ""
// convention (internal/domain/variable.go:160, 000008_variables.sql). What
// replaces it is narrower: `applies_to`, over a domain of exactly two.
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_ID",
  "applies_to": "all", "value": "prod-abc.apps.googleusercontent.com",
  "is_secret": false }

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_SECRET",
  "applies_to": "all", "secret_version": "secver_01KB3F8N2P9S5WQX",
  "is_secret": true }

// The override. Read only by `zitadel preview`, and only when it exists.
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_SECRET",
  "applies_to": "preview", "secret_version": "secver_01KB3F8N2P9S5WQY",
  "is_secret": true }
```

`all` is what every deploy reads. `preview` is read by `zitadel preview` in
preference to it, and a preview with no override row gets the `all` value.

This is not the sentinel that the
[snapshot](#why-not-one-table-with-a-null-deployment-id) section rules out: both
rows are store rows with the same columns, the same lifecycle and the same
mutability, and `applies_to` is never null. That objection was about two kinds
of record sharing one table.

```jsonc
// NEW TABLE - written once, in the transaction that writes the deployment row,
// and never updated. This is what a request reads; the table above is only what
// the next deploy will read.
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
  "secret_version": "secver_01KB3F8N2P9S5WQY" // referenced, never copied
}
```

## What a secret version is

**It does not exist today.** A secret variable is a row in `variables` whose
`value` column holds the encrypted value: `NewSecretVariable` encrypts with a
`crypto.Encrypter` and stores the ciphertext in the same column a plain value
uses (`internal/domain/variable.go:76`, `000008_variables.sql`). One value per
name, overwritten in place, no version and no separate table.

What this design needs instead is an append-only row per secret *value*:

| | |
|---|---|
| Id | `secver_<ULID>` — a prefix ADR 047 does not register yet |
| Holds | one encrypted value, written once, never updated |
| Pointed at by | the store row, as its current version |
| Pinned by | every snapshot row that deployed it |
| Rotation | appends a version and repoints the store row; nothing already deployed changes |
| Revocation | marks one version dead, and resolving it fails closed rather than falling forward to a newer one |

So `secret_version` in the entities above is a reference to one of those rows,
and the bytes of a secret exist in exactly one place.

**Why the snapshot references rather than copies.** Copying the ciphertext into
`deployment_variables` would be simpler, symmetrical with non-secrets, and would
give immutability just as well. What it cannot give is revocation: a leaked
value would live on in every snapshot that had copied it, and removing it would
mean rewriting rows this design calls immutable. The indirection buys the
ability to kill a value everywhere at once, and the reverse lookup that says
which deployments are still serving it.

## Why a snapshot and not just the store

**Rollback would otherwise lie.** It restores the release and not the values, so
rolling back to a release that needed last month's IdP client would get this
month's. Rolling back to a *deployment* restores the pair that was running.

**And a value edit mid sign-in would reshape an attempt underway** — the hazard
[sealing](4-release-resolution.md#the-three-layers) already removes for
resources, and which variables share until they are frozen too.

## Setting one

```
$ zitadel vars set GOOGLE_CLIENT_ID prod-abc.apps.googleusercontent.com
stored. not live until the next deploy.

$ zitadel vars set GOOGLE_CLIENT_SECRET --secret
value: ********
stored as secver_01KB3F8N2P9S5WQX. not live until the next deploy.

$ zitadel vars list
NAME                  TYPE    ALL DEPLOYS                 PREVIEWS
GOOGLE_CLIENT_ID      value   prod-abc.apps.googleu…      preview-xyz.apps.goog…
GOOGLE_CLIENT_SECRET  secret  secver_01KB…WQX  (10-02)    secver_01KB…WQY  (09-14)
SUPPORT_EMAIL         value   help@acme.com               —
```

One row per name, two columns, and `—` reads as "previews get the same value".
It answers only "what is stored". What is *running* is a different question with
a different answer per target, so it is a different command:

```
$ zitadel vars resolve --origin https://acme-git-sso-acmeinc.vercel.app
serving dep_01KB3F8N2P9S5WQZ   deployed 10-02 14:10

NAME                  SERVING NOW                FROM
GOOGLE_CLIENT_ID      preview-xyz.apps.goog…     preview override
GOOGLE_CLIENT_SECRET  secver_01KB…WQY            preview override
SUPPORT_EMAIL         help@acme.com              all deploys

  SUPPORT_EMAIL changed in the store since this deployment — deploy to apply
```

## How a preview gets different values

The value is set once, against the project, and the pipeline is told nothing:

```
$ zitadel vars set GOOGLE_CLIENT_SECRET --secret --preview
value: ********
stored as secver_01KB3F8N2P9S5WQY. applies to previews.
not live until the next preview deploy.
```

```yaml
- run: zitadel preview --ttl 7d
```

The snapshot then holds the preview value under the name the release asks for,
and `app.acme.com` keeps serving the production one. Same release, same project,
different credentials.

**The deploy request carries no variable names and no values** — a release and
its targets, nothing else. Every value is resolved server-side, from the store,
by the verb that asked. Three things follow:

- **There is nothing to forget.** A pipeline cannot deploy a preview carrying
  production credentials by leaving a flag out, because there is no flag.
- **The preview credential needs no variable permission at all**, not even the
  indirection of naming one, so [Prerequisites](6-cli-commands.md#prerequisites)
  gets narrower rather than wider.
- **No naming convention.** `GOOGLE_CLIENT_SECRET_PREVIEW` was two names a
  person had to keep in step; it is one name with two values.

### What this deliberately does not do

- **Per-branch values.** A flag that differs per branch is release content, not
  a variable: that branch's release already differs, which is where the
  difference belongs.
- **Per-origin values.** Two `primary` origins of one project always get the
  same values. Two hostnames that genuinely need different configuration are two
  projects — and if that ever stops being true, the answer is a third
  `applies_to` value, not a flag on the deploy.

### The hole this leaves

Nobody sets an override, so the preview runs the production value and nothing
says so. That is the one silent failure left, and a line of output closes it
better than a rule would:

```
$ zitadel preview --ttl 7d
origin      https://acme-git-sso-acmeinc.vercel.app
release     sha256:9f2c1a7b  (exists, reusing)

warning  GOOGLE_CLIENT_SECRET has no preview value — serving the production one
         set one: zitadel vars set GOOGLE_CLIENT_SECRET --secret --preview

deployed    dep_01KB3F8N2P9S5WQZ
```

Secrets only. A non-secret falling through to the `all` value is ordinary and
usually intended; a production client secret reachable from a preview URL is
worth interrupting a log for.

## Immutability at runtime

Four properties, each from a different part of the model:

1. **Snapshot rows are written once**, in the transaction that writes the
   deployment, so a deployment is never a partially-rewritten value set.
2. **Editing the store cannot reach a snapshot.** Different table, no shared row,
   no cascade. `zitadel vars set` during a sign-in changes nothing that
   sign-in can see.
3. **A flow seals the deployment id, not the release digest.** One pointer pins
   the resources *and* the values, so the two cannot drift apart mid-attempt.
   This replaces sealing the release, and is strictly stronger.
4. **[Secret versions](#what-a-secret-version-is) are immutable.** A rotation
   mints a new version; the old keeps its bytes for as long as a deployment
   references it. Revocation is the single exception and it fails closed — a
   revoked version refuses, rather than quietly resolving to a newer one.

## Why not one table with a null deployment id

Tempting — `variables(project_id, deployment_id, name, …)` where a null
`deployment_id` is the store. It is also what this table does for environments
today, and the scar tissue is visible: `000008_variables.sql` carries a generated
`environment_ref AS NULLIF(environment_id, '')` only because a composite foreign
key is skipped when a column is null, letting project-level rows opt out of a
constraint the scoped rows are held to.

**The sentinel pays off when a read has to fall back from the specific to the
general in one query** — exactly what this design no longer needs, since a deploy
freezes every name and a request reads snapshot rows only. The benefit is gone
and the costs are not:

- **Immutability stops being structural.** "Snapshot rows are never updated"
  becomes an invariant application code keeps rather than one the schema makes
  true; two tables give the snapshot no update path at all. Same objection that
  removed [`current_deployment_id`](1-data-model.md#why-there-is-no-pointer-column).
- **The wrong query leaks.** `zitadel vars list` becomes a filtered read
  that must never forget its filter; forget it once and it lists every
  historical value, superseded secret references included.
- **Half the columns would be null half the time**, and the lifecycles differ:
  tens of curated rows against tens of append-only rows per deployment.

A third shape — one row per distinct value, referenced by id — puts a join on the
request path to save copying short strings. Secrets are already references, so
the only thing it dedups is plaintext.

## Why the snapshot is a table and not a document

The deployment row already carries a `metadata` document, so a variables
document would have been idiomatic. But rotation needs the reverse lookup:
*which deployments still reference `secver_01KB…`*, so the old version can be
revoked once nothing serves it. That is a query by secret version, which a table
indexes and a JSON column in three dialects does not.

## What this changes elsewhere

- **`createDeployment`'s idempotency key moves.** It answers `200` and writes
  nothing today when the named release is already running. The key has to become
  the release *and* the resolved value set, or a deploy whose only purpose is a
  changed variable would be silently discarded.
- **A deploy may carry only a variable change.** Same release, new deployment
  row, so the history shows one digest twice with different snapshots. That is
  the fix for a wrong value: a deploy, not an edit.
- **Setting an override is the same permission as setting any value.** One
  table, one `variable.write`; anyone who can write the `all` row can already do
  worse than write the `preview` one.
- **Variables never move onto the release.** The same release has to run with
  different values on different origins, which is the preview case above.

## Prerequisites

**A versioned secret store.** A secret is a column today, so the rotation and
revocation properties above have nothing to rest on. It needs the append-only
table, a `secver` prefix registered by an amendment to ADR 047, and a resolver
that fails closed on a revoked version. Non-secret variables need none of it —
they work against the `value` column as it stands.

## Open

**Whether a variable-only deploy should be a distinct `reason`.** Reusing
`deploy` keeps the enum small but makes "the release did not change here"
something a reader has to notice from the digest rather than read.
