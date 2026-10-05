# Variables

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

Two mechanisms, kept apart on purpose. Most of the confusion in this area comes
from one thing trying to be both.

| | **The store** | **The snapshot** |
|---|---|---|
| Table | `variables` | `deployment_variables` |
| Keyed by | `(project_id, name)` | `(project_id, deployment_id, name)` |
| Written by | a person, when they decide a value | a deploy, in the same transaction as the deployment row |
| Changes later | yes, that is its job | never |
| Read by | the next deploy | every request |

The store is a flat list of names on the project. No scope, no pattern, no level
and no inheritance — **a name has one stored value.** Targeting lives in the
deploy, because the snapshot already records what each target runs and a second
targeting mechanism in the store would answer the same question twice, with the
two free to disagree.

```jsonc
// CHANGED - the `environment_id` column is removed rather than repurposed, and
// with it the generated `environment_ref` column, its foreign key and the ""
// convention (internal/domain/variable.go:160, 000008_variables.sql).
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_ID",
  "value": "prod-abc.apps.googleusercontent.com", "is_secret": false }

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_SECRET",
  "secret_version": "svs_01KB3F8N2P9S5WQX", "is_secret": true }
```

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
  "secret_version": "svs_01KB3F8N2P9S5WQY" // referenced, never copied
}
```

## Why a snapshot and not just the store

**Rollback would otherwise lie.** It restores the release and not the values, so
rolling back to a release that needed last month's IdP client would get this
month's. Rolling back to a *deployment* restores the pair that was running.

**And a value edit mid sign-in would reshape an attempt underway** — the hazard
[sealing](4-release-resolution.md#the-three-layers) already removes for
resources, and which variables share until they are frozen too.

## Setting one

```
$ zitadel variables set GOOGLE_CLIENT_ID prod-abc.apps.googleusercontent.com
stored. not live until the next deploy.

$ zitadel variables set GOOGLE_CLIENT_SECRET --secret
value: ********
stored as svs_01KB3F8N2P9S5WQX. not live until the next deploy.

$ zitadel variables list
NAME                          TYPE    STORED
GOOGLE_CLIENT_ID              value   prod-abc.apps.googleu…
GOOGLE_CLIENT_SECRET          secret  svs_01KB…  (set 10-02)
GOOGLE_CLIENT_ID_PREVIEW      value   preview-xyz.apps.goog…
GOOGLE_CLIENT_SECRET_PREVIEW  secret  svs_01KB…  (set 09-14)
```

One list, one value each, answering only "what is stored". What is *running* is
a different question with a different answer per target, so it is a different
command:

```
$ zitadel variables resolve --origin https://acme-git-sso-acmeinc.vercel.app
serving dep_01KB3F8N2P9S5WQZ   deployed 10-02 14:10

NAME                  SERVING NOW                FROM
GOOGLE_CLIENT_ID      preview-xyz.apps.goog…     bound to GOOGLE_CLIENT_ID_PREVIEW
GOOGLE_CLIENT_SECRET  svs_01KB…                  bound to GOOGLE_CLIENT_SECRET_PREVIEW
SUPPORT_EMAIL         help@acme.com              store

  SUPPORT_EMAIL changed in the store since this deployment — deploy to apply
```

## How a preview gets different values

A preview on a production project still has to use a different IdP client than
production. That difference is a property of **the deploy**, not of the project:
the pipeline creating previews is the thing that knows a preview is being
created. So the deploy binds a name to a different stored name:

```yaml
- run: zitadel preview --ttl 7d
         --bind GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID_PREVIEW
         --bind GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET_PREVIEW
```

The snapshot then holds the preview values under the names the release asks for,
and `app.acme.com` keeps serving the production ones. Same release, same
project, different credentials.

**A binding names a variable; it never carries a value.** That is what lets the
narrow preview credential of [Prerequisites](6-cli-commands.md#prerequisites) be
allowed to bind at all: resolving `GOOGLE_CLIENT_SECRET_PREVIEW` happens
server-side, so CI never holds the secret and a leaked pipeline token reveals no
values. A literal override is also allowed, for genuinely per-branch things and
only for non-secrets: `zitadel preview --var FEATURE_NEW_CONSENT=true`.

**What this costs.** The mapping repeats in every pipeline that deploys
previews, where a pattern scope would have stored it once. The trade is one
authoring model instead of two, visible next to the job that uses it, with no
server-side rule silently applying to origins nobody is looking at.

## Immutability at runtime

Four properties, each from a different part of the model:

1. **Snapshot rows are written once**, in the transaction that writes the
   deployment, so a deployment is never a partially-rewritten value set.
2. **Editing the store cannot reach a snapshot.** Different table, no shared row,
   no cascade. `zitadel variables set` during a sign-in changes nothing that
   sign-in can see.
3. **A flow seals the deployment id, not the release digest.** One pointer pins
   the resources *and* the values, so the two cannot drift apart mid-attempt.
   This replaces sealing the release, and is strictly stronger.
4. **Secret versions are immutable.** A rotation mints a new version; the old
   keeps its bytes for as long as a deployment references it. Revocation is the
   single exception and it fails closed — a revoked version refuses, rather than
   quietly resolving to a newer one.

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
- **The wrong query leaks.** `zitadel variables list` becomes a filtered read
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
*which deployments still reference `svs_01KB…`*, so the old version can be
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
- **Variables never move onto the release.** The same release has to run with
  different values on different origins, which is the preview case above.

## Open

**Whether a variable-only deploy should be a distinct `reason`.** Reusing
`deploy` keeps the enum small but makes "the release did not change here"
something a reader has to notice from the digest rather than read.
