# Releases Without Environments

> **Status:** Spike — [#1389](https://github.com/zitadel/nextgen/issues/1389).
> Design only; nothing here is implemented.
>
> **Related:** [ADR 035](../../../adrs/035-configuration-environments.md)
> (releases and deployments),
> [ADR 036](../../../adrs/036-api-credential-planes.md) (credential planes, the
> publishable key),
> [ADR 062](../../../adrs/062-per-environment-variables-and-secrets.md)
> (variables and secrets),
> [security and origins](../../api/security-and-origins.md),
> [project secret](../secret.md),
> [configuration surface](../configuration-surface.md).

The server has no environment *entity*. The word survives, on the client, where
everything that feeds it already lives; what goes away is the resource — the
`env_` id, the name index, the current-deployment pointer and the variable
scope. Two things take its place:

- **Which server and project** a client talks to is resolved on the client, from
  the process environment and `.env` files. An environment is a `(server,
  project)` pair held on the client — the name selects files and never reaches
  the server, and no server resource is keyed on it.
- **Which release** is served is resolved per request, from the exact origin the
  request arrived on. A preview is a URL serving a release, and the preview
  behind it is what admits the URL at all. A client may pin a release among
  those already deployed to its origin; it may never deploy one by pinning.

Three rules the rest of the documents keep returning to:

1. **Previews admit, patterns permit.** A request from a preview URL is served
   only while a live preview exists for that exact URL. A pattern says which
   URLs the preview credential may *register*, not which URLs a request may
   arrive from.
2. **A pin selects; it never activates.** `X-Zitadel-Release` may name a release
   that was deployed to the matched target and is not revoked. Anything else is
   refused.
3. **The credential is the boundary, not the verb.** A platform build holds
   only the preview credential and runs only `zitadel preview`; `zitadel deploy`
   runs after merge, with the project secret, somewhere a platform build is not.
   Whatever command a build runs, the credential it holds cannot move
   production.

## What changes

| | Today | Proposed |
|---|---|---|
| **Environment** | a server resource per project — `env_` id, unique name, current-deployment pointer, variable scope | gone from the server. A client-side label selecting `.env` files; nothing server-side is keyed on it |
| **What a deployment targets** | an environment | a set of targets — the project default (`""`), primary hostnames, or preview URLs. One deployment is one operation, with a target row per origin under it |
| **What a target serves** | the environment's `current_deployment_id` | the newest deployment to that origin. Append-only; rollback is another deployment |
| **Which release a request gets** | from the environment it names | from the `Origin` header it arrives with. A browser sends nothing new |
| **Origins** | `preview_origins`, exact strings, serving the preview secret | `origins`: patterns with a kind (`primary` or `preview`), plus a `preview` per live preview URL with an expiry. The preview admits a request; the pattern only bounds what may be registered |
| **Production vs development** | ADR 036: a publishable key per environment, allow-all only outside production | a `mode` on the project (`sandbox` or `production`) and one publishable key |
| **Variables** | per environment | per project, with a `preview` override and a frozen copy per deployment |
| **Pinning a release** | no header on `main`; the environments prototype let a client name a release deployed to its environment | `X-Zitadel-Release` may choose among releases already deployed to the matched target; it may never deploy one |
| **Promotion** | a release moves between environments | `deploy` against the other project, with a digest assertion |
| **CLI** | `--env` addresses a server resource | `deploy` and `preview` write deployments; `origin` and `variable` manage project state; `env` binds a directory to a `(server, project)` pair |

What a release is — an immutable bundle of resource revisions — does not change.
Each row above is argued in the document that owns it; this table only says
where to look.

## Areas

| # | Area | Doc |
|---|---|---|
| 1 | **Data model**: the entities, and the append-only deployment log that replaces the environment pointer | [`1-data-model.md`](1-data-model.md) |
| 2 | **Origins**: the patterns a project allows, the preview behind a live URL, what a wildcard on a shared host is worth, and the project mode | [`2-origins.md`](2-origins.md) |
| 3 | **Release resolution**: the three layers, pinning as selection, what each kind of caller sends, worked request examples, and local development | [`3-release-resolution.md`](3-release-resolution.md) |
| 4 | **Variables and secrets**: what the environment scope was doing, the one rule that survives it, and the values a deployment freezes | [`4-variables.md`](4-variables.md) |
| 5 | **CLI: finding the server and project**: environment resolution across flags, `process.env` and `.env` files | [`5-cli-environment-resolution.md`](5-cli-environment-resolution.md) |
| 6 | **CLI: commands**: `deploy`, `preview`, `deployment`, `origin`, `variable`, `release`, `env` | [`6-cli-commands.md`](6-cli-commands.md) |
| 7 | **CLI: adding a project as an environment**: binding one repository to a second project, what a platform build holds instead, and the staging recipes | [`7-cli-environments.md`](7-cli-environments.md) |

Prerequisites and Open sections sit in the document they belong to, covering
what that area needs that does not exist yet.
