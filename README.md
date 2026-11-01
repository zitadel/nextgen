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

| I want to...                                         | Run                                            |
| ---------------------------------------------------- | ---------------------------------------------- |
| Check local runtime prerequisites                    | `npx @zitadel/cli@latest doctor`               |
| Start local Zitadel                                  | `npx @zitadel/cli@latest start`                |
| Add auth to my app                                   | `npx @zitadel/cli@latest setup --server local` |
| Open the local console, signed in as the local admin | `npx @zitadel/cli@latest console`              |
| Check generated app files                            | `npx @zitadel/cli@latest doctor`               |
| Stop local Zitadel, keeping data                     | `npx @zitadel/cli@latest stop`                 |
| Delete local Zitadel data                            | `npx @zitadel/cli@latest reset --force`        |

The published `zitadel` runtime commands run the released local runtime through
the `@zitadel/server` npm binary by default and do not require Docker, Go, Moon,
or a source checkout. Docker remains available with
`zitadel start --runtime docker`.

### I am an agent (or driving one)

The CLI is the agent-facing surface today: every command supports
`--non-interactive --json` and returns a structured envelope.
[apps/cli/skills/zitadel-cli/SKILL.md](apps/cli/skills/zitadel-cli/SKILL.md) is the canonical contract for agents
integrating Zitadel into an app; [AGENTS.md](AGENTS.md) is for agents
contributing to this repository. The documentation site publishes LLM-friendly
text at `/docs/llms.txt`, `/docs/llms-full.txt`, and page-level `.md` URLs.

The CLI ships the Zitadel skills — the `zitadel` router skill, the CLI skill,
and the per-framework SDK and component skills — and adds the ones of its
version to your project, for any skills-compatible agent (Claude Code, Cursor,
Copilot, Codex, and more):

```sh
npx @zitadel/cli@latest skills add
```

They land in `.agents/skills/`, and in `.claude/skills/` for Claude Code. Run it
again after updating the CLI to keep them in step. To install them from this
repo's `main` instead, run `npx skills add zitadel/nextgen --full-depth`;
without `--full-depth`, only the router skill is installed.

After a successful interactive `setup`, the CLI suggests `skills add` once if it
finds a coding agent on your machine. "Once" is per machine, not per project: the
CLI records it in your user config directory. Set `NO_SKILLS_PROMPT=1` to never
see it.

## Customer quick start

```sh
mkdir myapp
cd myapp
npx @zitadel/cli@latest doctor
```

`doctor`, `setup` and `console` use the local server started in the current folder or in the nearest parent folder that has one, and `doctor` says which folder that is. A new, empty folder inside a folder where `start` ran therefore uses that server. To give the new folder a server of its own, run `npx @zitadel/cli@latest start` in it. `reset --force` deletes the local data of the folder it names, so check the folder `doctor` printed first.

Pick a server before running `setup`. It cannot be changed on this app
afterwards. Use `--server local` for local development, or point at a hosted
Zitadel Cloud instance if you want the project to belong to your team there.

### Local

```sh
npx @zitadel/cli@latest start
npx @zitadel/cli@latest setup --server local
npm run dev
```

`start` boots the local Zitadel runtime and creates a local admin,
`admin@zitadel.localhost`. It ends by telling you to run `setup`. Once `setup`
has created your project it offers `zitadel console`; before that the console has
nothing to show.

`setup --server local` creates the project and, by default, attaches it to
that admin's team, so the project is owned from the start and `zitadel claim`
reports it as already owned. If that attempt fails, setup prints a warning and
`zitadel claim` remains the way to attach it. If you turned the platform
bootstrap off, the server has no local admin and no claiming at all, so the
project simply has no owning team.

Once your project exists, print a sign-in link for the console. The link works once:

```sh
npx @zitadel/cli@latest console
```

The console shows your project and lets you add colleagues as project admins
by their email address. Pass `--no-open` to print the link instead of opening
a browser. For the admin credential file, how its password is handled, and
how to turn the local admin off, see [apps/cli/skills/zitadel-cli/SKILL.md](apps/cli/skills/zitadel-cli/SKILL.md).

Open http://localhost:3000/login and register your first user. That user is
an end user of your app, a different identity from the console admin above.
`setup` walks through the scaffold choices (such as which framework and use
case) and writes the app into the current directory; pass `--skip-install` if
you want to install dependencies yourself. The managed Zitadel runtime stores
its metadata and data under `.zitadel/local/`; `stop` preserves that data and
`reset --force` deletes it.

Once you have signed in to your app, run the CLI with no subcommand to see every
command, grouped by what you want to do:

```sh
npx @zitadel/cli@latest
```

With a global install, run `zitadel`. `zitadel <command> --help` lists a command's
options, and the help of a command or a family of commands points back to this list.

### Zitadel Cloud

```sh
npx @zitadel/cli@latest setup --server https://preview.zitadel.com
npm run dev
```

A hosted server has no local runtime to manage, so `start`, `stop`, `reset`
and `console` do not apply there. Once the app is up, attach the project to
your team:

```sh
npx @zitadel/cli@latest claim
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
| Liveness probe     | http://localhost:8080/livez       |
| Readiness probe    | http://localhost:8080/readyz      |

A fresh Compose server has no project and no user yet, so this console shows
its setup prompt until you seed one (see
[docker-compose.md](docs/quick-start/docker-compose.md)). On the CLI path
above, `zitadel console` signs you in as the local admin instead.

Details: [docs/quick-start/index.md](docs/quick-start/index.md). To build from source: [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation site

The documentation site lives in `apps/docs`: Fumadocs on Next.js, served
under `/docs`.

```sh
moon run docs:dev
moon run docs:build
```

The docs app bundles the OpenAPI source into a generated reference, has
search, and publishes LLM-friendly text at `/docs/llms.txt`,
`/docs/llms-full.txt` and page-level `.md` URLs, and an MCP server at
`/docs/api/mcp`.

## Current status

This repository is pre-release. The Go `server` command serves the OpenAPI
surface and embeds the console at `/ui/console/`; the login lives in your app.
Releases are `0.x` previews on npm's `latest` tag, and until 1.0.0 a minor
release can carry a breaking change
([ADR 074](docs/adrs/074-preview-releases-on-0x.md)).

For product direction and the four pillars, see [VISION.md](VISION.md).

## CI

Pull requests are gated by the GitHub Actions context `full-pr`, shown in the
pull request UI as `ci / full-pr`: generated-file checks, lint, type checks,
builds, unit and browser tests, the Go database lanes, a non-publishing release
snapshot, and the end-to-end suites against the snapshot's npm tarballs.
Changesets version PRs run a smaller release validation path instead. The full
step list is in [CONTRIBUTING.md](CONTRIBUTING.md#what-ci-runs).

## Releases

Moon builds the artifacts (Go binaries, containers, archives) and the draft
GitHub Release; Changesets owns versions, npm publishing, and release notes,
with the public packages on one fixed release train. Build a local snapshot with
`moon run release:snapshot` (more in [CONTRIBUTING.md](CONTRIBUTING.md)). To
cut or recover a release, follow the
[release runbook](docs/runbooks/manual-release.md); for when to add a
changeset, see [`.changeset/README.md`](.changeset/README.md); for the
rationale, see [ADR 002](docs/adrs/002-multi-package-release-strategy.md).
