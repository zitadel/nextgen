# CLI: Adding a Project as an Environment

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

How one repository comes to address several projects — starting local against a
local server, then binding a second environment to a project on a Zitadel
server.

## Environments: pointing one repository at several projects

An environment is a `(server, project)` pair held on the client, so "add a
production environment" is "bind a second environment to a second project". The
blocker today is that `.zitadel/secret` holds one project id and one secret, so
a repository can address exactly one project.

**The binding is called an environment, not a project.** `project` is a
resource — `proj_...`, with its own create and read operations — and per
[the layer hierarchy](../../api/hierarchy.md) a team in the platform project owns
*several* customer projects, so `acme-app` and `acme-admin` are two projects
belonging to one account. Using the word for a local label too would make
`zitadel projects add production` read as "create a nested project called
production", which is a different operation entirely.

Three words, three jobs, kept apart:

| Word | Lives | Means |
|---|---|---|
| **project** | server | the resource — `proj_...`, owns users, teams, releases |
| **environment** | client | a label binding `.env` files to one `(server, project)` |
| **target** | server | what a deployment moves — the project default, or an origin |

Nothing server-side is keyed on the middle row. That is the whole move: the
word stays, the resource goes.

### An environment is just its `.env` files

There is no environments block in `zitadel.json` and no fourth place for these
values to live. An environment is the set of `.env` files bearing its name, and
**none of them are committed** — the existing ignore rules (`.env*`, with
`!.env.example`) stay exactly as they are.

```ini
# .env.development.local
ZITADEL_URL=http://localhost:8080
ZITADEL_PROJECT_ID=prj_01KDEV7T9QX3M2E8
ZITADEL_PUBLISHABLE_KEY=pk_dev_4nYwH6tR2p
ZITADEL_PROJECT_SECRET=sk_proj_7kR2pXq9vN3wLmYhT4cB8A
```

```ini
# .env.production.local
ZITADEL_URL=https://api.zitadel.cloud
ZITADEL_PROJECT_ID=prj_01K9AA9M3K7E2QX8VB4T
ZITADEL_PUBLISHABLE_KEY=pk_7kR2pXq9vN3wLmYhT4cB8A
ZITADEL_PROJECT_SECRET=sk_proj_9f2Hx8LqT4vRmYpN2wCbVa
```

One file per environment, all of them local, or one file named outright with
[`--env-file`](5-cli-target-resolution.md#naming-one-file-instead-of-the-convention).
Because nothing is committed, there is no reason to split the public values from
the secret across two files — the split would buy nothing mechanical.
`.env.example`, which **is** committed, carries the key names with empty values
and is what tells a reader what an environment needs.

Three reasons this beats a block in `zitadel.json`:

- **These values have to be process environment variables anyway.** The framework
  inlines `NEXT_PUBLIC_ZITADEL_PROJECT_ID` into the browser bundle and the
  server-side SDK reads `ZITADEL_URL`. A `zitadel.json` entry would be a second
  copy of something that must exist in the environment regardless, and two
  copies have to agree.
- **A platform's environment store cannot write `zitadel.json`.** Vercel and
  Netlify inject `process.env`, which wins at step 3 of
  [target resolution](5-cli-target-resolution.md#target-resolution). A committed
  map would therefore be silently overridden in exactly the deployment where
  being wrong matters most — authoritative-looking and inert.
- **`zitadel.json` stays purely configuration content.** It describes what gets
  built into a release. Connection details are not that, and keeping them out
  means the bundle needs no carve-out for the parts of the file that must not
  ship. The
  [allowed origins](2-origins.md#why-the-allowlist-is-not-in-zitadeljson) are
  out for the same reason and fail the same way: a list that differs per project
  has nothing correct to say in a file every project shares.

### In CI there are no files, and no environment either

The production job gets `ZITADEL_URL`, `ZITADEL_PROJECT_ID` and
`ZITADEL_PROJECT_SECRET` injected by the platform or the pipeline's secret
store. Those land in `process.env`, which already outranks every file found by
convention, so no `.env` file is read and no `--env` is needed:

```yaml
# production job, after merge
- run: zitadel deploy -m "$MSG"
  env:
    ZITADEL_URL:            ${{ vars.ZITADEL_URL }}
    ZITADEL_PROJECT_ID:     ${{ vars.ZITADEL_PROJECT_ID }}
    ZITADEL_PROJECT_SECRET: ${{ secrets.ZITADEL_PROJECT_SECRET }}

# pull-request job — origin inferred from VERCEL_BRANCH_URL,
# and a credential that cannot widen the allowlist
- run: zitadel preview --ttl 7d
  env:
    ZITADEL_URL:           ${{ vars.ZITADEL_URL }}
    ZITADEL_PROJECT_ID:    ${{ vars.ZITADEL_PROJECT_ID }}
    ZITADEL_DEPLOY_TOKEN:  ${{ secrets.ZITADEL_PREVIEW_DEPLOY_TOKEN }}
```

The two jobs read correctly without a comment explaining which flag makes one
safe, which is the [two-verbs argument](6-cli-commands.md#zitadel-preview)
paying off in the place it matters.

This also clarifies what the name is actually for: **it only matters where
several targets coexist on one machine, which is a developer's laptop.** A CI job
has exactly one target by construction, injected. The environment is a local
affordance for switching between dev and prod from one checkout, not part of the
deployment contract.

### Discovery is server-side, not repository-side

Since nothing is committed, a teammate who clones the repository cannot see
which projects exist. The repository is the wrong place for that answer anyway:
it holds the shape (`.env.example`) and the server holds the inventory, and
neither needs to hold both.

**What the CLI can do today is narrower than that, and it is worth being exact
about the gap.** `zitadel env add` has two paths:

```
$ zitadel env add production
server?           https://api.zitadel.cloud
project?          [x] create a new one   [ ] bind an existing one
```

- **Create a new one** works now. `POST /projects` is `security: []` and returns
  the id with `project_secret` and `preview_secret`, so no credential is needed
  to get a project to bind. (The publishable key that replaces `preview_secret`
  is ADR 036's, and does not exist yet.)
- **Bind an existing one** takes an id, typed or pasted — whoever created it
  sends it over, the same way the project secret has to be sent over.

Offering a *list* instead needs something the CLI does not have: an identity for
the person running it. `queryProjects` is gated on `oauth2: [project.write]`,
while the CLI authenticates with the project secret it reads from
`.zitadel/secret` — and that secret is issued for one project, so it cannot
enumerate that project's siblings even in principle. There is no login command,
no device-code flow and no stored user token anywhere in `apps/cli`.

So the picker below is what this looks like **once a person can authenticate**,
and it is listed under [Prerequisites](#prerequisites) rather than described as
available:

```
$ zitadel env add production
server?   https://api.zitadel.cloud
project?  2 projects this team owns
          [x] acme          prj_01K9AA9M3K7E2QX8VB4T   class=production
          [ ] acme-admin    prj_01KBB2M4P7S9WQZ3F8N    class=sandbox
          [ ] create a new one
```

Nothing else in this design waits on it. Typing an id binds an environment just
as well as picking one from a list; the list only removes a copy-paste.

### Starting local

```
$ zitadel setup
server   local (http://localhost:8080)
project  prj_01KDEV7T9QX3M2E8  (created)
wrote    zitadel.json, .zitadel/secret, .env.local, .env.example
```

### Adding production

```
$ zitadel env add production
server?           https://api.zitadel.cloud
project?          [x] create a new one   [ ] bind an existing one
name?             acme

created           prj_01K9AA9M3K7E2QX8VB4T   class=sandbox   unclaimed
wrote             .env.production.local   URL, PROJECT_ID, PUBLISHABLE_KEY, PROJECT_SECRET

next
  zitadel allowlist add https://app.acme.com --kind primary  allow the origin
  zitadel deploy --env production                            ship configuration
  zitadel claim --env production                             attach an owner
  zitadel projects promote --env production                  class=production
```

Creating the project needs no credential — `POST /projects` is public. So the
whole journey is CLI-driven and nothing has to be done in a web console
first.

`zitadel env add` binds; `--project prj_...` binds a project that already
exists, created by a teammate or by `zitadel projects create`. The two steps are
separable because they are two concepts; offering to create one is only sugar.
`--project` means "bind this id" here and nowhere else — it is
[not a resolution override](5-cli-target-resolution.md#target-resolution).

```
$ zitadel env list
ENVIRONMENT   SERVER                       PROJECT                   CLASS     CLAIMED
development   local                        prj_01KDEV7T9QX3M2E8      sandbox   —
production    https://api.zitadel.cloud    prj_01K9AA9M3K7E2QX8VB4T  sandbox   no

resolved now  development
              (no --env, ZITADEL_ENV unset, NODE_ENV=development)
```

Enumeration is a glob over `.env.*.local` for files carrying
`ZITADEL_PROJECT_ID`, plus whatever `process.env` currently supplies. An
environment that exists only in a CI secret store is invisible locally, which is
correct — it is not a target this machine can reach. A file named only by
`--env-file` is invisible too, for the same reason: nothing on disk points at it.

**Two environments may point at the same project.** A `.env.preview.local` that
repeats production's project id says plainly that previews run against
production users, which is the thing worth noticing. Pointing it at a third
project instead buys user isolation, and costs a project. Nothing is seeded
either way.

### Shipping to it

The new project is empty. The same `.zitadel/` builds a release in it, over
fresh revisions of its own.

```
$ zitadel deploy --env production -m "initial release"
environment  production   https://api.zitadel.cloud   prj_01K9AA9M3K7E2QX8VB4T
building     6 resources
release      sha256:4a5b6c7d  (new in this project)

  no deployment yet — 6 resources will be created
  targets: (default), https://app.acme.com  (primary, already allowed)

continue? [y/N] y
deployed     dpl_01KC4N8P2S5WQZ   2 deployment records written
```

The allowlist is read here, never written. `deploy` fans out over the `primary`
origins the project already allows, so
[allowing one](2-origins.md#why-the-allowlist-is-not-in-zitadeljson) is the
step before this rather than part of it — which is why `zitadel env add`
suggests it first.

**`new in this project` is the open question made concrete.** The development
project holds the same content under a different digest, because a pointer
digest covers revision ids and those are per-project. With a content digest the
two would match and `deploy` could assert it — see [Open 1](1-data-model.md#open).

### Making it production

The class belongs to the project, so the verb is a project verb, addressed by
the environment that selects it.

```
$ zitadel claim --env production
claimed    team_acme

$ zitadel projects promote --env production
revalidating 2 origins against the production rules
  https://app.acme.com           primary   exact origin      ✓
  https://*-acmeinc.vercel.app   preview   tenant-anchored   ✓
class      sandbox -> production
```

`promote` is free as a verb because release promotion no longer needs it.
`zitadel projects demote` is the reverse, and asks for confirmation because it
lets loopback origins back into a project holding real users.

## Prerequisites

**A person's identity in the CLI**, for the project picker above and for nothing
else on this page. It needs a browser or device-code flow, a token stored
outside the repository, and `queryProjects` scoped to the teams that identity
belongs to. Until then `zitadel env add` creates a project or takes an id, both
of which work with what exists.
