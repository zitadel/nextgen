# Zitadel — next generation

Add registration and login to your app, with your own branding. Zitadel handles credentials, sessions, and tokens underneath, with tools built for developers and AI agents.

> **This is a preview.** We're rebuilding Zitadel's storage core and API, and things are still changing — including APIs, CLI flags, packages, and docs. You can try it locally or self-host it; Cloud support comes later. This work lives in a separate repository for now and is intended to become the foundation of a future major version in [zitadel/zitadel](https://github.com/zitadel/zitadel). See [VISION.md](VISION.md) for where we're heading.

## Where to start

### Adding Zitadel to your app?

Follow the [quick start](#try-it-locally) below. These are the commands you'll use most:

| I want to… | Run |
| --- | --- |
| Check my local setup | `npx @zitadel/cli@alpha doctor` |
| Start Zitadel locally | `npx @zitadel/cli@alpha start` |
| Add authentication to my app | `npx @zitadel/cli@alpha setup --server local` |
| Open the Console | `npx @zitadel/cli@alpha console` |
| Stop Zitadel and keep my data | `npx @zitadel/cli@alpha stop` |
| Delete my local Zitadel data | `npx @zitadel/cli@alpha reset --force` |

The CLI runs Zitadel through the `@zitadel/server` npm package. You don't need Docker, Go, Moon, or a checkout of this repository. If you prefer Docker, use `zitadel start --runtime docker`.

### Contributing to Zitadel?

Head to [CONTRIBUTING.md](CONTRIBUTING.md) for setup, running from source, testing, and releases. Instructions for coding agents working on this repository live in [AGENTS.md](AGENTS.md).

### Working with an AI agent?

Install the Zitadel skills into your agent:

```sh
npx skills add zitadel/nextgen --full-depth
```

This installs the main Zitadel skill, the CLI skill, and the framework-specific SDK and component skills. Without `--full-depth`, only the main skill is installed. The CLI skill also comes with the `@zitadel/cli` package.

The [CLI skill](apps/cli/skills/zitadel-cli/SKILL.md) explains how to integrate Zitadel into an app. Commands support `--non-interactive --json` for automation, with structured output.

The documentation site also provides `/docs/llms.txt`, `/docs/llms-full.txt`, and Markdown versions of individual pages.

## Try it locally

Start with a new directory and check that your machine is ready:

```sh
mkdir myapp
cd myapp
npx @zitadel/cli@alpha doctor
```

Start Zitadel, then set up your app:

```sh
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
```

`start` creates a local admin and prints a one-time link to the Console.

`setup` asks about your app, generates the files, and installs dependencies. It also creates a Project owned by your local admin's Team, ready to manage in the Console. To install dependencies yourself, pass `--skip-install`.

Now run your app:

```sh
npm run dev
```

Open the URL printed by your development server and visit `/login`. Register a user to try the authentication flow. This is a user of your app; your local admin is the account you use to manage Zitadel.

### Open the Console

In another terminal, from the same app directory, run:

```sh
npx @zitadel/cli@alpha console
```

This signs you in as the local admin so you can manage your Project. Whenever you need a fresh sign-in link, run the command again. Use `--no-open` if you'd prefer to copy the link into a browser yourself.

More about local admin credentials and configuration: [CLI guidance](apps/cli/skills/zitadel-cli/SKILL.md).

### When you're done

Stop Zitadel while keeping your data:

```sh
npx @zitadel/cli@alpha stop
```

Your local runtime data stays in `.zitadel/local/`. To delete it and start fresh, run:

```sh
npx @zitadel/cli@alpha reset --force
```

## Run with Docker Compose

To explore the server directly, run the API and its built-in UIs with Docker Compose from this repository:

```sh
cd docs/operations
cp env.example .env
docker compose up -d
```

| Open… | URL |
| --- | --- |
| Console | http://localhost:8080/ui/console/ |
| Sign-in page | http://localhost:8080/ui/login/ |
| Health endpoint | http://localhost:8080/healthz |

A fresh Compose server has no Project or user, so the Console shows a setup prompt until you seed one. Follow the [Docker Compose guide](docs/quick-start/docker-compose.md) for that step. With the CLI setup above, `zitadel console` signs you in as the local admin.

See the [quick-start docs](docs/quick-start/index.md) for more options, or [CONTRIBUTING.md](CONTRIBUTING.md) to build from source.

## Work on the docs

The documentation site lives in `apps/docs` and uses Fumadocs on Next.js, served under `/docs`.

```sh
moon run docs:dev
moon run docs:build
```

It includes a generated API reference, search, Markdown pages for agents, and an MCP server at `/docs/api/mcp`.

## What's available today?

This repository is pre-release. The Go `server` command serves the API and includes the Console at `/ui/console/` and login UI at `/ui/login/`. CI builds installable snapshots for testing and review.

For the wider product direction, see [VISION.md](VISION.md).

## Checks and CI

Pull requests run the `ci / full-pr` check. It covers generated files, lint, type checks, builds, unit and browser tests, Go database tests, a release snapshot, and end-to-end tests against the snapshot's npm packages.

Changesets version PRs use a smaller set of release checks. See [CONTRIBUTING.md](CONTRIBUTING.md#what-ci-runs) for the full list.

## Releases

Moon builds the binaries, containers, archives, and draft GitHub Release. Changesets handles versions, npm publishing, and release notes. Public packages share one alpha release version.

To build a local snapshot:

```sh
moon run release:snapshot
```

For more detail, see:

- [Release runbook](docs/runbooks/manual-release.md) — cutting or recovering a release
- [Changeset guide](.changeset/README.md) — when and how to add a changeset
- [ADR 002](docs/adrs/002-multi-package-release-strategy.md) — the release strategy
