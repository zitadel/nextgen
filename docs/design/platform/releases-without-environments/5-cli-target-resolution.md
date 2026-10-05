# CLI: Finding the Server and Project

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

How the CLI decides which server and which project a command addresses, from the
process environment and `.env` files. Nothing here reaches the server.

## Target resolution

Two values per invocation: a server URL and a project id, plus a credential for
writes. Each resolves independently, highest priority first:

1. `--server` — where to send, which the credential does not say
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

Environment detection, highest priority first: `--env`, `ZITADEL_ENV`, a
platform signal, else `development`. The name is local only: it selects which
[`.env` files](7-cli-environments.md#environments-pointing-one-repository-at-several-projects)
to read, and never reaches the server. `NODE_ENV` is deliberately not
consulted: Vercel and Netlify set it to `production` for every build, preview
builds included, so it says which build mode the framework is in and nothing
about where the result will be served.

The platform signals, and what each one is worth:

| Platform | Signal | Says |
|---|---|---|
| Vercel | `VERCEL_ENV` | `production`, `preview` or `development` |
| Netlify | `CONTEXT` | `production`, `deploy-preview`, `branch-deploy` or `dev` |
| Cloudflare Pages | `CF_PAGES=1`, `CF_PAGES_BRANCH` | that it is a Pages build, and the branch — **not** whether it is the production branch |
| Cloudflare Workers Builds | `WORKERS_CI=1`, `WORKERS_CI_BRANCH` | the same |
| Railway | `RAILWAY_ENVIRONMENT` | the environment's name |

Cloudflare has no production signal a build can read, so the one recipe that
works on every platform is to set `ZITADEL_ENV=production` in the platform's
**production-scoped** environment variables and nothing in the preview scope.
Every platform here scopes variables by environment, and that scoping is also
what puts the right credential in the right job —
[what a platform build holds](7-cli-environments.md#what-a-platform-build-holds).
Where the platform does say, `VERCEL_ENV` and `CONTEXT` are read as a
fallback; `ZITADEL_ENV` wins when both are present.

**`--env`, and the server still has none.** The flag is called `--env` because
everything feeding it already is — `VERCEL_ENV`, `CONTEXT`,
`.env.production.local`. What the old model got wrong was not the word but the
location: an environment was a server resource with an id, a unique name index,
a current deployment and a variable scope, so `GET /environments/{name}` existed
and two clients could hold different ideas of what `staging` meant. Here the
name never leaves the machine. There is no environment id, no endpoint, and
nothing server-side keyed on the name — if a `/environments` resource ever
reappears, that is this design being undone.

**There is no `--project`.** A project id is not independently selectable,
because the credential already carries it: a project secret is issued for one
project, and ADR 036 has the publishable key replace "loose `project_id` request
fields as the attribution mechanism". So `--project` could only ever name a
project the resolved credential does not authenticate, which is a `401` at best
and a silently ignored flag at worst. `--server` survives because it says *where
to send* rather than *who you are* — `--server local` against a locally running
server, with the same directory, is the case it exists for, and it is already a
flag the CLI has.

`--project` does appear in this design, as an argument to
[`zitadel env add`](7-cli-environments.md#adding-production) meaning "bind this
existing project". That is a different job from overriding a resolved value, and
one flag doing both is how it would get confusing.

A genuine one-off against another project is `--env-file ./that.env`, or the
three variables exported for one command. Both name a coherent triple; a bare
project id does not.

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

It exists for the layouts the convention does not reach: a monorepo where the
file does not sit beside the working directory, or a CI job that materialises one
from its secret store.

Two consequences, both deliberate:

- **It outranks `process.env`.** A path the caller typed on this invocation is
  as explicit as `--server`, so an injected `ZITADEL_PROJECT_ID` does not quietly
  win over a file the operator named. That is the one exception to the rule
  below.
- **The environment is named after the file**, and nothing is inferred from
  the platform. The name is used for display and for nothing else, so a file
  with no recognisable name costs nothing.

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
| `ZITADEL_RELEASE` | set by the build; read by the server-side SDK — optional |
| `NEXT_PUBLIC_ZITADEL_PROJECT_ID` / `_PUBLISHABLE_KEY` / `_RELEASE`, and the `VITE_…` and `NUXT_PUBLIC_…` equivalents | browser bundle |

No `.env` file is committed, so the public/secret column decides only where a
value may be *shared* — a publishable key can go in a team chat or a CI variable,
the project secret only in a secret store.

The release variables are optional. A caller answered by layer 2 sends nothing
new; a build that sets them [pins](3-release-resolution.md#pinning-a-release)
the bundle to the release it was built against, which the server honours only
for a release already deployed to that target. `zitadel deploy` and
`zitadel preview` print the digest for the build to pick up, and never write
it to a file — a build that wants the pin reads it from the command's output,
or from `zitadel env`, which shows what the working copy would build.

`vercel env pull` writes the platform's variables into `.env.local`, which is
step 5 of the chain. For a Vercel project that is the shortest way to bind a
laptop to the project the platform deploys: pull, and the CLI resolves the
same triple the build does.
