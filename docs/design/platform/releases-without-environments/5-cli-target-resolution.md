# CLI: Finding the Server and Project

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

How the CLI decides which server and which project a command addresses, from the
process environment and `.env` files. Nothing here reaches the server.

## Target resolution

Two values per invocation: a server URL and a project id, plus a credential for
writes. Each resolves independently, highest priority first:

1. `--server`, `--project`
2. `--env-file <path>` — for the keys it defines; no other file is read
3. `process.env` — so a platform's environment store and CI beat anything on disk
4. `.env.<environment>.local`
5. `.env.local` — skipped when the environment is `test`
6. `.env.<environment>`
7. `.env`
8. `.zitadel/secret`, for project id and secret — the bootstrap default
9. Interactive prompt, TTY only, persisted to `.env.<environment>.local`
10. Error naming the environment, the missing value, and every file consulted

`zitadel.json` is **not** in this chain. It describes configuration content, not
which server to send it to — see
[environments](7-cli-environments.md#environments-pointing-one-repository-at-several-projects).

Environment detection, highest priority first: `--env`, `ZITADEL_ENV`, platform
signals (`VERCEL_ENV`, `NETLIFY_CONTEXT`, `RAILWAY_ENVIRONMENT`), `NODE_ENV`,
`development`. The name is local only: it selects which
[`.env` files](7-cli-environments.md#environments-pointing-one-repository-at-several-projects)
to read, and never reaches the server.

**`--env`, and the server still has none.** The flag is called `--env` because
everything feeding it already is — `VERCEL_ENV`, `NODE_ENV`,
`.env.production.local`. What the old model got wrong was not the word but the
location: an environment was a server resource with an id, a unique name index,
a current deployment and a variable scope, so `GET /environments/{name}` existed
and two clients could hold different ideas of what `staging` meant. Here the
name never leaves the machine. There is no environment id, no endpoint, and
nothing server-side keyed on the name — if a `/environments` resource ever
reappears, that is this design being undone.

The two flags do different jobs: `--env <name>` selects which `.env` files to
read, while `--project <id>` names a project id directly and overrides whatever
they say.

### Naming one file instead of the convention

`--env` picks files by the `.env.<name>.local` convention. `--env-file` names one
file outright, and the two are **mutually exclusive** — passing both is an error
rather than a merge, because the whole point of the second is to not search.

```
$ zitadel deploy --env-file ./infra/acme-staging.env -m "initial release"
environment  acme-staging   (./infra/acme-staging.env)
server       https://api.zitadel.cloud   (file)
project      prj_01KBB2M4P7S9WQZ3F8N     (file)
```

It earns its place in three situations the convention does not reach: a monorepo
where the file does not sit beside the command's working directory, a CI job that
materialises a file from its secret store, and a repository whose layout predates
this tool and is not going to be reorganised for it.

Two consequences worth stating, because both are deliberate:

- **It outranks `process.env`.** Typing a path is as explicit as typing
  `--project`, so an injected `ZITADEL_PROJECT_ID` does not quietly win over a
  file the operator named. That is the one exception to the rule below, and it
  exists only for an argument the caller passed on this invocation.
- **The environment is named after the file**, and nothing is inferred from
  `NODE_ENV`. The name is used for display and for nothing else, so a file with
  no recognisable name costs nothing.

Keys the file does not define still fall through — resolution is per value, so a
file holding only a project id leaves `ZITADEL_URL` to `process.env`.

**Otherwise dotenv never overrides the real process environment.** A platform
injecting `ZITADEL_PROJECT_ID` must beat a stale `.env` left in the working tree
or baked into a container image, or a deploy silently talks to the wrong project.

| Variable | Notes |
|---|---|
| `ZITADEL_URL` | server base URL — public |
| `ZITADEL_PROJECT_ID` | project — public |
| `ZITADEL_PUBLISHABLE_KEY` | public-plane bearer — public |
| `ZITADEL_PROJECT_SECRET` | CLI and server-side SDK — **secret** |
| `ZITADEL_RELEASE` | set by the build; read by the server-side SDK |
| `NEXT_PUBLIC_ZITADEL_PROJECT_ID` / `_PUBLISHABLE_KEY` / `_RELEASE`, and the `VITE_…` and `NUXT_PUBLIC_…` equivalents | browser bundle |

No `.env` file is committed, so the public/secret column decides only where a
value may be *shared* — a publishable key can go in a team chat or a CI variable,
the project secret only in a secret store.

The release variables are only needed on the fallback path. A browser caller
answered by layer 2 sends nothing new.
