# Zitadel — next generation

The next generation of the Zitadel identity platform, built for developers
and AI agents alike: registration and login live in your app, under your
brand, while Zitadel guards the credentials, sessions, and tokens underneath.

> **Preview status:** This work rebuilds Zitadel's storage core and API
> surface, so it ships as a preview in its own repository and is intended to
> merge back into [zitadel/zitadel](https://github.com/zitadel/zitadel) as the
> foundation of a future major version. APIs, CLI flags, package surfaces, and
> docs are still in flux. Create-first, claim-later is the product direction,
> and `zitadel claim` ships in this repo
> ([ADR 046](docs/adrs/046-claim-lifecycle-v2.md)). The full story is in
> [VISION.md](VISION.md).

## Workflow front doors

### I am contributing to Zitadel

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributor setup (including the
devcontainer), Moon commands, local checks, integration tests, source builds,
and release workflows. Agent-facing workspace rules live in
[AGENTS.md](AGENTS.md).

### I am adding Zitadel to my app

| I want to...                                         | Run                                           |
| ---------------------------------------------------- | --------------------------------------------- |
| Check local runtime prerequisites                    | `npx @zitadel/cli@alpha doctor`               |
| Start local Zitadel                                  | `npx @zitadel/cli@alpha start`                |
| Add auth to my app                                   | `npx @zitadel/cli@alpha setup --server local` |
| Open the local console, signed in as the local admin | `npx @zitadel/cli@alpha console`              |
| Check generated app files                            | `npx @zitadel/cli@alpha doctor`               |
| Stop local Zitadel, keeping data                     | `npx @zitadel/cli@alpha stop`                 |
| Delete local Zitadel data                            | `npx @zitadel/cli@alpha reset --force`        |

The published `zitadel` runtime commands run the released local runtime through
the `@zitadel/server` npm binary by default and do not require Docker, Go, Moon,
or a source checkout. Docker remains available with
`zitadel start --runtime docker`.

### I am an agent (or driving one)

The CLI is the agent-facing surface today: every command supports
`--non-interactive --json` and returns a structured envelope.
[apps/cli/SKILLS.md](apps/cli/SKILLS.md) is the canonical contract for agents
integrating Zitadel into an app; [AGENTS.md](AGENTS.md) is for agents
contributing to this repository. The documentation site publishes LLM-friendly
text at `/llms.txt`, `/llms-full.txt`, and page-level `.md` URLs.

## Customer quick start

```sh
mkdir myapp
cd myapp
npx @zitadel/cli@alpha doctor
```

Pick a server before running `setup`. It cannot be changed on this app
afterwards. Use `--server local` for local development, or point at a hosted
Zitadel Cloud instance if you want the project to belong to your team there.

### Local

```sh
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
npm run dev
```

`start` boots the local Zitadel runtime and creates a local admin,
`admin@zitadel.localhost`. It ends by printing a sign-in link for the
management console. That link works once.

`setup --server local` creates the project and, by default, attaches it to
that admin's team, so the project is owned from the start and `zitadel claim`
reports it as already owned. If that attempt fails, setup prints a warning and
`zitadel claim` remains the way to attach it. If you turned the platform
bootstrap off, the server has no local admin and no claiming at all, so the
project simply has no owning team.

Any time you need the console again, print a fresh link:

```sh
npx @zitadel/cli@alpha console
```

The console shows your project and lets you add colleagues as project admins
by their email address. Pass `--no-open` to print the link instead of opening
a browser. For the admin credential file, how its password is handled, and
how to turn the local admin off, see [apps/cli/SKILLS.md](apps/cli/SKILLS.md).

Open http://localhost:3000/login and register your first user. That user is
an end user of your app, a different identity from the console admin above.
`setup` walks through the scaffold choices (such as which framework and use
case) and writes the app into the current directory; pass `--skip-install` if
you want to install dependencies yourself. The managed Zitadel runtime stores
its metadata and data under `.zitadel/local/`; `stop` preserves that data and
`reset --force` deletes it.

### Zitadel Cloud

```sh
npx @zitadel/cli@alpha setup --server https://api.zitadel.cloud
npm run dev
```

A hosted server has no local runtime to manage, so `start`, `stop`, `reset`
and `console` do not apply there. Once the app is up, attach the project to
your team:

```sh
npx @zitadel/cli@alpha claim
```

This opens a browser so you can sign in with your own Zitadel account (not
one of the app's end users) and attach the project to your team. The link
prints before any browser opens, so it works over SSH or headless too
(`--no-open`); nothing about the running project changes. Claiming only
works within 14 days of running `setup`. After that, `setup` a fresh
project instead.

## Manual Docker quick start

Run the API and embedded UIs with Docker Compose when you want to inspect the
operator-style stack directly:

```sh
cd docs/operations
cp env.example .env
docker compose up -d
```

| Surface            | URL                               |
| ------------------ | --------------------------------- |
| Management console | http://localhost:8080/ui/console/ |
| Sign-in shell      | http://localhost:8080/ui/login/   |
| Health             | http://localhost:8080/healthz     |

This console asks for a password. On the CLI path above, `zitadel console`
signs you in as the local admin instead.

Details: [docs/quick-start/index.md](docs/quick-start/index.md). To build from source: [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation site

The Fumapress/Fumadocs documentation skeleton lives in `apps/docs`.

```sh
moon run docs:dev
moon run docs:build
```

The docs app bundles the OpenAPI source into a generated reference, exposes
static search, and publishes LLM-friendly text at `/llms.txt`,
`/llms-full.txt`, page-level `.md` URLs, and `/mcp`.

## Current status

This repository is pre-release. The Go `server` command serves the OpenAPI
surface and embeds the console and login UIs at `/ui/console/` and `/ui/login/`.
CI produces installable snapshots for review, not official releases.

For product direction and the four pillars, see [VISION.md](VISION.md).

## CI

Pull requests are gated by the GitHub Actions context `full-pr`, shown in the
pull request UI as `ci / full-pr`. On a 16-core runner it runs a Go
generated-file drift check, lint, type checks, builds, unit and browser
tests, Go tests including Postgres/Spanner/SQLite dialect integration, a
non-publishing release snapshot, and fresh-app journeys against the snapshot's
npm tarballs.
Changesets version PRs run a smaller release validation path instead, and
Changesets comments give release-intent feedback without adding a blocking
gate. The full step list lives in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) and
[CONTRIBUTING.md](CONTRIBUTING.md#what-ci-runs).

## Releases

Moon builds the artifacts (Go binaries, containers, archives) and the draft
GitHub Release; Changesets owns versions, npm publishing, and release notes,
with the public packages on one fixed alpha train. Build a local snapshot with
`moon run release:snapshot` (more in [CONTRIBUTING.md](CONTRIBUTING.md)). To
cut or recover a release, follow the
[release runbook](docs/runbooks/manual-release.md); for when to add a
changeset, see [`.changeset/README.md`](.changeset/README.md); for the
rationale, see [ADR 002](docs/adrs/002-multi-package-release-strategy.md).
