# Variables

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

A variable belongs to an **owner** today, and an owner is a project or one
environment of it. Removing environments removes one of the two owners. What
follows is what that takes away, the one thing the environment scope was doing
that still has to work, and where a deployment gets its values once no scope
holds them.

They are **variables and secrets**, not environment variables — nothing puts
them in a process environment — so the CLI calls them `vars` and leaves `env` to
the [client-side environment](7-cli-environments.md#environments-pointing-one-repository-at-several-projects).

## The environment scope today

ADR 062 is called *Per-Environment Variables and Secrets*, and the scope is its
subject: "that scope is composed of the project-ID and the environment-ID", with
name plus scope unique, so no other identifier is needed. Resolution is an exact
match on all three — the ADR is explicit that there is no inheritance, and that
adding levels later is what would raise the question.

| | Where |
|---|---|
| Keyed `(name, project_id, environment_id)`, `environment_id` NOT NULL DEFAULT `''` for the project level | `000008_variables.sql` |
| Generated `environment_ref AS NULLIF(environment_id, '')`, which exists only so the composite foreign key is skipped for project-level rows | the same file |
| `VariableOwner{ProjectID, EnvironmentID}`, and `HasAccessTo` enforcing that an owner reaches exactly what it entered | `internal/domain/variable.go:150` |
| `environment_name`, selecting the owner on `getVariables`, `updateVariables`, `getVariable` and `deleteVariable` | `components/parameters/environment-name-query.yaml` |

Two consequences of owners being separate rather than a ladder are worth having
in front of you, because the first is what removal fixes and the second is what
removal has to keep:

- **A value that holds everywhere is entered everywhere.** The parameter's own
  description says so: "A value that has to hold in several environments is
  entered in each of them." Reading everything a project holds means reading
  each owner in turn.
- **A value that must *not* hold everywhere has somewhere to go.** The
  production IdP client secret can be entered on the production environment and
  nowhere else.

## What goes

| Today | After |
|---|---|
| `environment_id`, `environment_ref`, the foreign key to `environments` and the `''` convention | gone from `variables`; the project foreign key already cascades on its own |
| `environment_name` on four operations | gone; a project has one list of variables |
| Reading each owner in turn | one read |
| Entering the same value in each environment | entered once |
| `VariableOwner.EnvironmentID` | an owner is a project |
| ADR 062's scope, and its two-owner model | an amendment: one owner, plus the axis below |

Nothing is migrated: the column is dropped rather than repurposed.

## The one rule that survives

A preview on a production project must not hold the production IdP client. The
URL is reachable by anyone who can guess it, and the whole point of the URL is
that it is not production — so this one distinction cannot go with the
environments.

It becomes a column on the variable, not a scope: `applies_to` is `all` or
`preview`, there is no third value, and two rows per name is the maximum.

```jsonc
// CHANGED - `environment_id` is removed rather than repurposed, and with it the
// generated `environment_ref` column, its foreign key and the "" convention.
// What replaces it is narrower: `applies_to`, over a domain of exactly two.
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_ID",
  "applies_to": "all", "value": "prod-abc.apps.googleusercontent.com",
  "is_secret": false }

// UNCHANGED - a secret is its ciphertext in the same `value` column a plain
// value uses, with `is_secret` set (`NewSecretVariable` encrypts with a
// `crypto.Encrypter`, internal/domain/variable.go:76).
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_SECRET",
  "applies_to": "all", "value": "<ciphertext>", "is_secret": true }

// The override. Read only by `zitadel preview`, and only when it exists.
{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "name": "GOOGLE_CLIENT_SECRET",
  "applies_to": "preview", "value": "<ciphertext>", "is_secret": true }
```

`all` is what every deploy reads. `preview` is read by `zitadel preview` in
preference to it, and a preview with no override row gets the `all` value. That
is the only fall-through in the design, it is one level deep, and it is the only
thing `applies_to` does — nothing addresses an origin, a pattern or a branch.

### What this deliberately does not do

- **Per-branch values.** A flag that differs per branch is release content, not
  a variable: that branch's release already differs, which is where the
  difference belongs.
- **Per-origin values.** Two production hostnames of one project always get the
  same values. Two hostnames that genuinely need different configuration are two
  projects — and if that ever stops being true, the answer is a third
  `applies_to` value, not a flag on the deploy.

## Setting one

```
$ zitadel vars set GOOGLE_CLIENT_ID prod-abc.apps.googleusercontent.com
stored. not live until the next deploy.

$ zitadel vars set GOOGLE_CLIENT_SECRET --secret
value: ********
stored, encrypted. not live until the next deploy.

$ zitadel vars list
NAME                  TYPE    ALL DEPLOYS                 PREVIEWS
GOOGLE_CLIENT_ID      value   prod-abc.apps.googleu…      preview-xyz.apps.goog…
GOOGLE_CLIENT_SECRET  secret  set 10-02                   set 09-14
SUPPORT_EMAIL         value   help@acme.com               —
```

One list, no owner to choose, and `—` reads as "previews get the same value".
There is no `--env` on any of it.

## How a preview gets different values

The value is set once, against the project, and the pipeline is told nothing:

```
$ zitadel vars set GOOGLE_CLIENT_SECRET --secret --preview
value: ********
stored, encrypted. applies to previews.
not live until the next preview deploy.
```

```yaml
- run: zitadel preview --ttl 7d
```

**The deploy request carries no variable names and no values** — a release and
its targets, nothing else. Every value is resolved server-side by the verb that
asked, which is what replaces choosing an owner. Three things follow:

- **There is nothing to forget.** A pipeline cannot deploy a preview carrying
  production credentials by leaving a flag out, because there is no flag.
- **The preview credential needs no variable permission at all**, not even the
  indirection of naming one, so [Prerequisites](6-cli-commands.md#prerequisites)
  gets narrower rather than wider.
- **No naming convention.** `GOOGLE_CLIENT_SECRET_PREVIEW` was two names a
  person had to keep in step; it is one name with two values.

### The hole this leaves

Nobody sets an override, so the preview runs the production value and nothing
says so. Entering it on one environment and not the other was at least visible;
this is not. A line of output closes it better than a rule would:

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

## What a deployment runs

With no environment, there is no scope to read "the environment's current
values" from, and the deployment history is
[append-only](1-data-model.md#why-there-is-no-pointer-column). So each
deployment freezes the values it resolved, in one new table, written in the same
transaction as the deployment row and never updated:

```jsonc
// NEW TABLE - keyed (project_id, deployment_id, name). This is what a request
// reads; `variables` is only what the next deploy will read.
{
  "project_id":    "prj_01K9AA9M3K7E2QX8VB4T",
  "deployment_id": "dep_01KB3F8N2P9S5WQZ",
  "name":          "GOOGLE_CLIENT_SECRET",
  "value":         "<ciphertext>", // copied, like any other value
  "is_secret":     true
}
```

Same columns as the store, so a secret is copied as the ciphertext it already
is and this design needs no secret store it does not already have.

Freezing is not an extra: without it, **rollback would lie**. It restores the
release and not the values, so rolling back to a release that needed last
month's IdP client would hand it this month's. Rolling back to a *deployment*
restores the pair that was running. Inspecting what a target froze takes an
origin rather than an environment name, since that is what identifies a target
now:

```
$ zitadel vars resolve --origin https://acme-git-sso-acmeinc.vercel.app
serving dep_01KB3F8N2P9S5WQZ   deployed 10-02 14:10

NAME                  SERVING NOW                FROM
GOOGLE_CLIENT_ID      preview-xyz.apps.goog…     preview override
GOOGLE_CLIENT_SECRET  (secret, set 09-14)        preview override
SUPPORT_EMAIL         help@acme.com              all deploys

  SUPPORT_EMAIL changed in the store since this deployment — deploy to apply
```

Two properties follow from the table being separate and write-once. Editing the
store reaches no deployment — `zitadel vars set` during a sign-in changes
nothing that sign-in can see — and a flow that
[seals the deployment id](3-release-resolution.md#the-three-layers) pins the
resources and the values with one pointer, so they cannot drift apart mid
attempt.

## What changes elsewhere

- **Four operations lose `environment_name`.** `getVariables` and
  `updateVariables` on `/variables`, `getVariable` and `deleteVariable` on
  `/variables/{variable_name}`. Their descriptions carry the owner model
  explicitly — "an environment does not inherit the project's variables and the
  project does not see its environments'" — and that paragraph goes with the
  parameter.
- **`createDeployment`'s idempotency key moves.** It answers `200` and writes
  nothing today when the named release is already running. The key has to become
  the release *and* the resolved value set, or a deploy whose only purpose is a
  changed variable would be silently discarded.
- **A deploy may carry only a variable change.** Same release, new deployment
  row, so the history shows one digest twice with different frozen values. That
  is the fix for a wrong value: a deploy, not an edit.
- **Setting an override is the same permission as setting any value.** One
  table, one `variable.write`; anyone who can write the `all` row can already do
  worse than write the `preview` one.
- **Variables never move onto the release.** The same release has to run with
  different values on different origins, which is the preview case above.

## Open

1. **Whether a variable-only deploy should be a distinct `reason`.** Reusing
   `deploy` keeps the enum small but makes "the release did not change here"
   something a reader has to notice from the digest rather than read.
2. **Revoking a leaked secret reaches nothing already deployed.** Rotating the
   store changes what the next deploy freezes and nothing that is running, so
   the old value is served until every target is redeployed, and its bytes
   survive in each frozen set until that deployment is collected. Making
   revocation immediate wants a secret stored once and referenced rather than
   copied, which is a versioned secret store — more machinery than removing
   environments needs, and better decided on its own.
