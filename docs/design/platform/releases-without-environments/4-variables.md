# Variables

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

A variable belongs to a project or to one environment of it. Removing
environments removes one of those two owners. The CLI calls them `vars`, because
they are variables and secrets rather than process environment variables, and
`env` names the
[client-side environment](7-cli-environments.md#environments-pointing-one-repository-at-several-projects).

## The environment scope today

ADR 062 is called *Per-Environment Variables and Secrets*: the scope is the
project id plus the environment id, matched exactly, with no inheritance in
either direction.

| | Where |
|---|---|
| Keyed `(name, project_id, environment_id)`, with `''` for the project level, plus a generated `environment_ref` whose only job is to let those rows skip the foreign key | `000008_variables.sql` |
| `VariableOwner{ProjectID, EnvironmentID}`, and `HasAccessTo` holding an owner to what it entered itself | `internal/domain/variable.go:150` |
| `environment_name`, picking the owner on `getVariables`, `updateVariables`, `getVariable` and `deleteVariable` | `components/parameters/environment-name-query.yaml` |

Because the owners are separate rather than a ladder, "a value that has to hold
in several environments is entered in each of them" — the parameter's own
words — and reading everything a project holds means reading each owner in turn.
What the separation buys is the other half: a production client secret can be
entered on the production environment and nowhere else.

## What goes

| Today | After |
|---|---|
| `environment_id`, `environment_ref` and the foreign key to `environments` | dropped; the project foreign key already cascades |
| `environment_name` on four operations | a project has one list |
| Reading each owner in turn | one read |
| The same value entered in each environment | entered once |
| `VariableOwner.EnvironmentID` | an owner is a project |
| ADR 062's scope | an amendment: one owner, plus `applies_to` below |

Nothing is migrated — the column is dropped, not repurposed.

## The one rule that survives

A preview must not hold the production client secret: its URL is reachable by
anyone who can guess it, and the whole point of the URL is that it is not
production. So that distinction cannot go with the environments. It becomes a
column rather than a scope — `applies_to` is `all` or `preview`, with no third
value, so two rows per name is the maximum.

```jsonc
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_ID",
  "applies_to": "all", "value": "prod-abc.apps.googleusercontent.com",
  "is_secret": false }

// UNCHANGED - a secret is its ciphertext in the same `value` column, with
// `is_secret` set (internal/domain/variable.go:76).
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_SECRET",
  "applies_to": "all", "value": "<ciphertext>", "is_secret": true }

// The override. Read by `zitadel preview`, and only when it exists.
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_SECRET",
  "applies_to": "preview", "value": "<ciphertext>", "is_secret": true }
```

Every deploy reads the `all` rows. `zitadel preview` prefers a `preview` row
where one exists and takes the `all` value where it does not. That is one level
deep, and it is all `applies_to` does: nothing addresses an origin, a pattern or
a branch.

Two things it deliberately cannot express. **Per-branch values** are release
content — that branch's release already differs, so the difference belongs
there. **Per-origin values** are two projects; if that ever stops being true the
answer is a third `applies_to` value, not a flag on the deploy.

## Setting one

```
$ zitadel vars set GOOGLE_CLIENT_SECRET --secret
value: ********
stored, encrypted. not live until the next deploy.

$ zitadel vars list
NAME                  TYPE    ALL DEPLOYS                 PREVIEWS
GOOGLE_CLIENT_ID      value   prod-abc.apps.googleu…      preview-xyz.apps.goog…
GOOGLE_CLIENT_SECRET  secret  set 10-02                   set 09-14
SUPPORT_EMAIL         value   help@acme.com               —
```

One list, no owner to choose, no `--env` anywhere, and `—` reads as "previews
get the same value".

## How a preview gets different values

The value is set once, against the project, and the pipeline is told nothing —
`zitadel vars set GOOGLE_CLIENT_SECRET --secret --preview`, then
`zitadel preview --ttl 7d` in the job.

**The deploy request carries no variable names and no values**: a release and
its targets, nothing else. The server resolves every value from the store, by
the verb that asked, which is what replaces choosing an owner. So a pipeline
cannot ship a preview with production credentials by leaving a flag out, because
there is no flag; the preview credential needs no variable permission at all,
which keeps [Prerequisites](6-cli-commands.md#prerequisites) narrow; and
`GOOGLE_CLIENT_SECRET_PREVIEW`, two names somebody had to keep in step, becomes
one name with two values.

**The hole it leaves** is that nobody sets an override, so the preview serves the
production value and nothing says so. Entering it on one environment and not the
other was at least visible; this is not. A line of output closes it better than
a rule would:

```
$ zitadel preview --ttl 7d
origins     https://acme-git-sso-acmeinc.vercel.app
            https://acme-k3x9v2-acmeinc.vercel.app
release     sha256:9f2c1a7b  (exists, reusing)

warning  GOOGLE_CLIENT_SECRET has no preview value — serving the production one
         set one: zitadel vars set GOOGLE_CLIENT_SECRET --secret --preview

deployed    dpl_01KB3F8N2P9S5WQZ   2 deployment records written
```

Secrets only. A non-secret taking the `all` value is ordinary and usually
intended.

Worth knowing before investing in overrides: an OAuth client's redirect URI
cannot be a wildcard at Google or GitHub, and a preview's callback lives on the
preview URL. So social login on a wildcard preview is limited by the IdP before
it is limited by which client secret the preview holds. The override matters
most for IdPs that accept a wildcard, and for anything that is not a redirect
— SMTP, SMS, webhooks.

## What a deployment runs

With no environment there is no scope holding "the current values", and the
deployment history is
[append-only](1-data-model.md#why-there-is-no-pointer-column). So each
deployment freezes what it resolved, in one new table written in the same
transaction as the deployment row and never updated:

```jsonc
// NEW TABLE - keyed (project_id, deployment_id, name). Same columns as the
// store, so a secret is copied as the ciphertext it already is.
{
  "project_id":    "prj_01K9AA9M3K7E2QX8VB4T",
  "deployment_id": "dep_01KB3F8N2P9S5WQZ",
  "name":          "GOOGLE_CLIENT_SECRET",
  "value":         "<ciphertext>",
  "is_secret":     true
}
```

Freezing is not an extra. Without it **rollback would lie**: it restores the
release and not the values, so rolling back to a release that needed last
month's client secret would hand it this month's. Two more properties follow
from the table being separate and write-once — editing the store reaches no
deployment, so `zitadel vars set` during a sign-in changes nothing that sign-in
can see, and a flow that
[seals the deployment id](3-release-resolution.md#the-three-layers) pins the
resources and the values with one pointer.

A client that [pins a release](3-release-resolution.md#pinning-a-release) names
a release, not a deployment, and the same release may sit on a target twice
with different frozen values. The pin resolves to the newest deployment of
that release on the matched target, so a variable-only redeploy reaches pinned
clients as well as unpinned ones.

Reading it takes an origin rather than an environment name, since that is what
identifies a target now:

```
$ zitadel vars resolve --origin https://acme-git-sso-acmeinc.vercel.app
serving dep_01KB3F8N2P9S5WQZ   deployed 10-02 14:10

NAME                  SERVING NOW                FROM
GOOGLE_CLIENT_ID      preview-xyz.apps.goog…     preview override
GOOGLE_CLIENT_SECRET  (secret, set 09-14)        preview override
SUPPORT_EMAIL         help@acme.com              all deploys

  SUPPORT_EMAIL changed in the store since this deployment — deploy to apply
```

## What changes elsewhere

- **`createDeployment`'s idempotency key moves.** It answers `200` and writes
  nothing today when the named release is already running, so the key has to
  become the release *and* the resolved values, or a deploy whose only purpose
  is a changed variable is silently discarded.
- **A deploy may carry only a variable change.** Same release, new deployment
  row, so the history shows one digest twice with different values. That is the
  fix for a wrong value: a deploy, not an edit.
- **Variables never move onto the release.** The same release has to run with
  different values on different origins, which is the preview case above.

## Open

1. **Whether a variable-only deploy should be a distinct `reason`.** Reusing
   `deploy` keeps the enum small but makes "the release did not change here"
   something a reader has to notice from the digest.
2. **Revoking a leaked secret reaches nothing already deployed.** Rotating the
   store changes what the next deploy freezes, not what is running, so the old
   value is served until every target is redeployed and its bytes survive in
   each frozen set until that deployment is collected. Immediate revocation
   wants a secret stored once and referenced rather than copied — a versioned
   secret store, which is more than removing environments needs and is better
   decided on its own.
