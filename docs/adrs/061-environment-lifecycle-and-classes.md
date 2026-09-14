# ADR 061: Environment Lifecycle and Classes

> **Status:** Proposed
> **Date:** 2026-09-10
> **Context:** Environments — lifecycle and classes (#965); part of the
> Environments epic (#528)
> **Builds on:** [ADR 035](035-configuration-environments.md) (environments are
> runtime slots that run one release at a time),
> [ADR 007](007-gitops-configuration-surface.md) (the repo describes the
> configuration, the server is not its source of truth),
> [ADR 042](042-scaffolded-file-ownership-and-drift-detection.md)
> (`.zitadel/state.json` records local-to-server bookkeeping)

## Context

This ADR decides whether the set of environments is fixed or configurable, and which lifecycle operations exist.

## Status quo

**Server**:

Environments were introduced as a prerequisite to releases and deployments. During project creation, the server automatically creates `{"dev", "staging", "prod"}` environments, before the `seed_defaults` flag is evaluated.

The environments are "environment identity" only: `(project_id, id, name, created_at)`, unique on `(project_id, name)`.
The API is read-only: `GET /environments` and `GET /environments/{name}`, and `environment.created` is the only event type.

**CLI**:

During the setup commands, the CLI writes a `zitadel.json` file which contains a `environments` object:

```json
{
  "$schema": "https://schemas.zitadel.com/v2/project.schema.json",
  "branding": {
    "attribution": "visible",
    "renderer": "react"
  },
  "environments": {
    "development": {
      "issuer": "http://localhost:3000"
    },
    "preview": {
      "issuer_pattern": [
        "http://localhost:3000"
      ]
    }
  },
  "framework": {
    "id": "next"
  },
  "preset": "password-first",
  "project": "proj_01M22ET3J3VHNPW0JVWSVA28GR",
  "server": "http://localhost:8080",
  "useCase": "minimal"
}
```

The only real usage of the `zitadel.json environments` is to print an `open <url>` hint in `status` and as the first of three fallbacks in `doctor`.

The `--environment` flag is declared in three commands: `apply`, `plan`, `schemas list`. It is passed to `resolveServer`, used to pick a server URL, and **discarded**. No API call carries it.

## Decisions

### 1. The environment set is chosen at setup

**The developer picks the project's environments during `zitadel setup`. There is no default set. A project has at least one environment at all times, `POST /projects` seeds exactly one named `dev`, and `setup` reconciles the chosen set on top of it.**

`setup` asks which environments the project needs:

```
Which environments does this project need?

  [X] dev
  [ ] staging
  [ ] prod
  [ ] Other — enter a name
```

`dev` is preselected; at least one selection is required.

Each selected environment then gets an issuer, because a production environment
is invalid without one. `dev` is prefilled with the detected local development
origin — the dev-server port the wizard already asks for — and the rest are
asked for, blank for a non-production environment and required for `prod`:

```
Where is prod served?

  https://acme.com
```

The answers are written as one file per environment under
`.zitadel/environments/`. A developer who does not know their production origin
yet leaves `prod` out of the set and adds it later; selecting it and declining
to name an origin is not an option the wizard offers.

The project itself is created with exactly one environment named `dev`, seeded server-side inside the creation transaction. That is what guarantees the at-least-one invariant for every caller.

### 2. An environment is a configuration resource

**Environments are declared under `.zitadel/environments/<name>.json`, one file per environment.**

Every configurable resource under `.zitadel/` is a JSON document with a `$schema` pointer into `.zitadel/meta/`, edited in the repo and pushed to the server. Environments follow the same convention:

```
.zitadel
├── branding
│   ├── branding.json
│   └── login.liquid
├── environments          # new
│   ├── dev.json
│   ├── staging.json
│   └── prod.json
├── flows
│   └── default-login.json
├── meta
│   └── environment.json  # new
├── schemas
│   └── default-human-user.json
├── secret
└── state.json
```

One important difference: the contents of `.zitadel/environments/` are not bundled into releases. A release is an immutable snapshot of revisioned resources, and a deployment makes a release live *on an environment* — so an environment cannot be inside the thing deployed to it. `.zitadel/` already holds content that is not release input: `state.json`, `secret`, `local/`, and `meta/`.

### 3. The environment file and its meta-schema

**One file per environment, validated by a meta-schema shipped into `.zitadel/meta/` like every other kind.**

The schema is authored at `api/openapi/endpoints/schemas/environment.json`, the
directory the server embeds and `@zitadel/config` copies from (#1195), so there
is one source and `setup` materializes it with the rest.

```json
{
  "$schema": "../meta/environment.json",
  "name": "prod",
  "issuer": ["https://acme.com", "https://app.acme.com"],
  "production": true
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | Yes | How the environment is addressed. Lowercase DNS label, at most 63 characters. |
| `issuer` | Optional | A customer-owned origin, or an array of them, on which the application's UI and OIDC endpoints run. |
| `issuer_pattern` | Optional | A wildcard pattern for environments whose origin is dynamic. Mutually exclusive with `issuer`. |
| `production` | No, defaults to `false` | The production class toggle. See [decision 8](#8-environments-can-be-marked-as-production). |

Both origin fields are optional and mutually exclusive; exactly one of them is
required when `production` is true. A non-production environment may declare
either, or neither — with neither it is inert until an origin is added.

#### Meta-schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Environment",
  "description": "A runtime slot of a project. Each environment runs one configuration release at a time and declares the origins it is served on.",
  "type": "object",
  "required": ["name"],
  "additionalProperties": false,
  "not": { "required": ["issuer", "issuer_pattern"] },
  "properties": {
    "$schema": {
      "type": "string",
      "description": "Path or URL of this meta-schema so editors validate and autocomplete."
    },
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$",
      "maxLength": 63,
      "examples": ["dev", "staging", "prod", "qa", "live"],
      "description": "How this environment is addressed. Authoritative over the filename — editing it renames the environment, which keeps its id, deployments, class and running release."
    },
    "issuer": {
      "description": "The customer-owned origin, or origins, on which this environment's UI and OIDC endpoints are served.",
      "oneOf": [
        { "$ref": "#/$defs/origin" },
        {
          "type": "array",
          "items": { "$ref": "#/$defs/origin" },
          "minItems": 1,
          "uniqueItems": true
        }
      ]
    },
    "issuer_pattern": {
      "type": "string",
      "pattern": "^https://\\*\\.[a-z0-9-]+(\\.[a-z0-9-]+)+$",
      "examples": ["https://*.vercel.app", "https://*.preview.acme.com"],
      "description": "A single-label wildcard for environments whose origin is dynamic, preview deployments being the case it exists for. Mutually exclusive with `issuer`."
    },
    "production": {
      "type": "boolean",
      "default": false,
      "description": "Whether this environment is production-class. True tightens which origin declarations are accepted."
    }
  },
  "if": {
    "properties": { "production": { "const": true } },
    "required": ["production"]
  },
  "then": {
    "oneOf": [{ "required": ["issuer"] }, { "required": ["issuer_pattern"] }],
    "properties": {
      "issuer": {
        "oneOf": [
          { "$ref": "#/$defs/secure_origin" },
          {
            "type": "array",
            "items": { "$ref": "#/$defs/secure_origin" },
            "minItems": 1,
            "uniqueItems": true
          }
        ]
      }
    }
  },
  "$defs": {
    "origin": {
      "type": "string",
      "pattern": "^(https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*|http://(localhost|127\\.0\\.0\\.1|\\[::1\\]))(:[0-9]{1,5})?$",
      "examples": ["https://acme.com", "http://localhost:3000"],
      "description": "An origin: `https://` anywhere, or `http://` on canonical loopback for local development. No trailing slash, path, query or fragment."
    },
    "secure_origin": {
      "type": "string",
      "pattern": "^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$",
      "examples": ["https://acme.com", "https://app.acme.com"],
      "description": "An `https://` origin. Production-class environments accept nothing else."
    }
  }
}
```

The schema decides what the file alone can decide: the name format, `issuer`
exclusive with `issuer_pattern`, and a production environment declaring an
`https` origin. The shared-hosting suffix list is server-side and checked there.

### 4. Environments are managed via their own commands

**Environments are managed separately from the other configuration resources such as user schemas and flows.**

The lifecycle is managed via `zitadel environments list` and `zitadel environments apply` commands, which operate over create/update/delete APIs.

| Command | Direction | Purpose |
|---|---|---|
| `zitadel environments list` | read | Lists the project's environments as the server holds them, with each one's current deployment. |
| `zitadel environments apply` | local → server | Synchronizes environments from local to the server: create, update and delete. |

The CLI is the writing surface. The console reads environments and does not
write them, so `apply` is one-way: local to server. Pulling a change made
outside the repo back into `.zitadel/` is a problem every configuration
resource has equally, and it is not solved here.

`zitadel environments apply` reports its diff before acting; in interactive mode the developer confirms, and in non-interactive mode removals require an explicit `--confirm-removals`, matching the removal-safety rule ADR 035 already defines for `deploy`.

It applies creates and updates before deletes, so the "at least one environment"
invariant holds at every point of the run. Replacing a sole `dev` with a sole
`qa` would otherwise delete the last environment first and be rejected by the
server. The sync engine's shared planner queues deletes first
(`apps/cli/src/lib/sync/loop.ts`), so this is an ordering environments require
of it, not one they inherit.

### 5. The environment is explicit on the API, inferred by the CLI when there is only one

**Some endpoints take an environment as request argument, and will continue to do so. As a convenience, the CLI automatically supplies the environment when there is a single environment in the project.**

There is no concept of a default environment on the server.

```
$ zitadel deploy                 # one environment: resolved, nothing to type
$ zitadel deploy --env prod      # two or more: required
```

The moment a second environment exists, `--env` is required again.

### 6. An environment can be renamed

**Renaming is editing `name` in the file and running `apply`.**

`staging` becomes `qa`, `prod` becomes `live`, and it is the same environment afterwards.

```diff
  {
    "$schema": "../meta/environment.json",
-   "name": "staging",
+   "name": "qa",
    "issuer": "https://staging.acme.com"
  }
```

```
$ zitadel environments apply
  ~ staging → qa   env_01KX…
  renamed .zitadel/environments/staging.json → qa.json
```

#### Why the field, and not the filename

`.zitadel/state.json` keys resources by **file path**, and the resource's handle lives in the file body — that is how flows and schemas already work. Environments follow the same pattern, so a file at a stable path whose `name` changed is an update, not a delete and a create.

### 7. An environment can be deleted

**Deleting requires that the environment is neither `production` nor the last one. The delete is a hard-delete, the row and its deployment records are removed, and the name becomes reusable.**

Removing `.zitadel/environments/<name>.json` and running `zitadel environments apply` deletes the environment, subject to two guards enforced on the server, not only in the CLI:

- **A `production` environment cannot be deleted.** It must first be declared `production: false` in its file and synchronized, and only then removed.
- **The last environment cannot be deleted.** A project always has at least one.

The deployment records go with it: they answer "what is running where", and a
deleted environment runs nothing. The releases they referenced are untouched —
releases are project-scoped artifacts, so one the deleted environment ran stays
deployable to the others. There is no drain and no undeploy step; deleting the
slot is what stops the release it was running.

Nothing else reads that history — rollback replays an environment's own past
deployments, and promote reads the source environment's current one — so
removing it breaks no other operation. What it does cost is the record that a
release was ever live there, because no deployment event type exists today
(`release.created` and `environment.created` do). Defining one belongs to the
deployments surface (#532); with it, the audit trail survives the delete in the
events log, where [ADR 048](048-wide-events-internal-audit-primitive.md) puts
it.

### 8. Environments can be marked as `production`

**`production: true` rejects localhost issuers and shared-hosting wildcards. The toggle belongs to the environment, not the project.**

`production` is a boolean on the environment, and it decides which origin
declarations the server will accept.

A boolean rather than a class enum, because the set of names is open. Once a
developer can call an environment `qa`, `sandbox` or `demo`, there is no class
to map it to that would not be a guess — the name and the class would stop
agreeing the moment either is chosen freely. What is actually known today is
what production must refuse; everything else is one open category with no rule
of its own. If a second rule appears later — rate limits being the likely one —
it becomes its own field, not a third class value.

A **non-production** environment accepts:

- `https://` origins — `https://acme.com`, `https://app.acme.com`.
- Loopback origins over plain HTTP — `http://localhost:3000`, `http://127.0.0.1:3000`,
  `http://[::1]:3000`.
- Shared-hosting wildcards — `https://*.vercel.app`, `https://*.netlify.app`,
  `https://*.pages.dev`, and the rest of the server's known-safe suffix list.
- Custom-domain wildcards — `https://*.preview.acme.com`.
- No declaration at all: the environment is inert until one is added, and the CLI may infer one from the local dev server.

A **production** environment accepts:

- `https://` origins — the same explicit form, and the one production is expected to use.
- Custom-domain wildcards — `https://*.acme.com`. Accepted as declared; proving
  ownership of the domain is out of scope.

and rejects:

- Loopback and any other plain-HTTP origin.
- Shared-hosting wildcards.
- Having no declaration at all.

## Overlapping decisions

Two things the environment file touches that this ADR deliberately does not
settle.

**Variables.** Configuration values that differ per environment are stored as variables ([#1145](https://github.com/zitadel/nextgen/pull/1145)): a variable belongs to a project and optionally to one of its environments.

The non-secret variables could reasonably be declared in `.zitadel/environments/<name>.json` alongside `issuer` and `production`, which
would make an environment's whole shape one reviewable file. Secrets could not: the file is committed, and variables marked secret are write-only by design.

**The issuer.** The concept already exists twice — on the project, and per environment in `zitadel.json`. It belongs to the environment: the issuer is the origin that environment is served on, and two environments of one project are served on different ones. This ADR puts `issuer` / `issuer_pattern` there and decides no more than that. What they feed — the origin allowlist, and detecting which environment a request belongs to — is the scope of [#968](https://github.com/zitadel/nextgen/issues/968).

## Implementation details

### API

The existing read endpoints stay as they are. Three writes are added, all addressing the environment by name in the path.

| Endpoint | Purpose |
|---|---|
| `POST /environments` | Create. `{ name, issuer? \| issuer_pattern?, production? }`. |
| `PATCH /environments/{name}` | Update the declaration or the class. A `name` in the payload renames; 409 if taken. |
| `DELETE /environments/{name}` | Delete, subject to the production and last-environment guards. |

### Authorization

Environments get their own permissions, like every other project-scoped
configuration resource: `environment.read`, `environment.write` (create, update,
rename and the `production` toggle) and `environment.delete`. They are added to
the [system permission catalog](../design/api/system-permission-catalog.md)
beside `domain.*` and `allowed_origin.*`, and follow its conventions — flat
`{resource}.{verb}`, `read` covering get and list, and `project.write` not
implying any of them.

Scope comes from the grant, as it does for every other entry in that catalog, so
a grant covers a project's environments rather than one of them. That answers
what [#958](https://github.com/zitadel/nextgen/issues/958) is waiting on here.
Per-environment grants stay possible without new machinery — `authz_assignments`
already has a `resource` scope kind — but nothing grants at that scope, and the
`production` class carries origin rules, not authorization weight. A principal
who can create an environment can therefore also promote one to production, or
demote and delete it; the guards in decision 7 are invariants the server
enforces on everyone, not a second permission tier.

### Events

`environment.created` exists; two more are added:

| Event | Payload |
|---|---|
| `environment.updated` | The changed fields, delta semantics. Covers renames and `production` transitions alike. |
| `environment.deleted` | The name, and the count of deployment records removed with it. |

### CLI state

Environments join `resources` in `.zitadel/state.json`, the map the sync engine already keys by file path — `".zitadel/environments/dev.json": { "id": "env_01KX…", "hash": "…" }`.

Because the key is the path, a rename has to move it. `apply` renames the file
and rewrites the state key under the same id, and does so after the server has
confirmed the rename. Leaving the key on the old path would make the next run
read a missing path as a delete and the new path as a create — destroying the
identity the rename exists to preserve. A run interrupted between the two
recovers on the next `apply`: the id is on the server, so a state entry whose
path no longer exists is re-keyed to the file holding that id rather than
treated as a removal.

## Alternatives considered

**Environments in `zitadel.json`.** That file is the CLI's own pointer config — which server to talk to, the renderer id, the preset — and the console never reads it. An environment is a server resource with an id, events, permissions and a read API, and the console has to be able to show it. Putting it in `zitadel.json` would make the CLI the only surface that knows the set exists.
