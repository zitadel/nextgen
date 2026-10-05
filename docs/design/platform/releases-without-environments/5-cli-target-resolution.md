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
2. `process.env` — so a platform's environment store and CI beat anything on disk
3. `.env.<stage>.local`
4. `.env.local` — skipped when the stage is `test`
5. `.env.<stage>`
6. `.env`
7. `.zitadel/secret`, for project id and secret — the bootstrap default
8. Interactive prompt, TTY only, persisted to `.env.<stage>.local`
9. Error naming the stage, the missing value, and every file consulted

`zitadel.json` is **not** in this chain. It describes configuration content, not
which server to send it to — see
[stages](7-cli-stages.md#stages-pointing-one-repository-at-several-projects).

Stage detection, highest priority first: `--stage`, `ZITADEL_STAGE`, platform
signals (`VERCEL_ENV`, `NETLIFY_CONTEXT`, `RAILWAY_ENVIRONMENT`), `NODE_ENV`,
`development`. The stage is local only; it selects which `.env` files to read and
which [`.env` files](7-cli-stages.md#stages-pointing-one-repository-at-several-projects) to
read, and never reaches the server.

**`--stage`, not `--env`.** The selector is deliberately not called `--env`: the
server has no environments, and a flag that says otherwise is the one place a
developer would most reasonably conclude it does. `ZITADEL_ENVIRONMENT` is
deleted for the same reason. The platform signals keep their own names because
they belong to Vercel and Netlify, not to us.

The two flags do different jobs: `--stage <name>` selects which `.env` files to
read, while `--project <id>` names a project id directly and overrides whatever
they say.

**Dotenv never overrides the real process environment.** A platform injecting
`ZITADEL_PROJECT_ID` must beat a stale `.env` left in the working tree or baked
into a container image, or a deploy silently talks to the wrong project.

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
