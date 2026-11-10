# cli-skill-e2e

An **agent eval** for the `zitadel-cli` Agent Skill. It does not test the CLI's
commands (those have their own tests). It checks whether an agent that only has
the skill can get working auth into an app: the right commands, few turns, low
tokens, and an outcome that holds up when the live instance and the app are
asked, whatever the agent said.

## How it works

A **scenario** is a model, with or without the skill. A **journey** is a starting
point and a list of questions a developer asks. Every scenario × journey is one
Vitest project that runs the journey as a stateful conversation, one `it` per
stage:

- **The test runs on the host.** It owns the temp directory, the simulated
  developer's turns, the checks and the grading.
- **The agent runs in a container.** A small HTTP server inside it
  ([`container/agent-server.ts`](container/agent-server.ts)) runs the agent's
  turns, the simulated developer, the CLI reads and the browser checks. The test
  speaks to it over HTTP on a loopback port with a per-run token. The temp
  directory is mounted into the container, so the host can read the app.
- **Journeys are data.** Each file in [`journeys/`](journeys) holds the prompts,
  the developer persona and what a stage must leave behind.

"Non-interactive" describes how the agent drives the CLI, not its conversation
with the developer. A stage with a `user` persona is a real conversation: the
agent asks, a cheap simulated developer answers from the persona.

## Journeys

| journey | starts from | what it asks |
| --- | --- | --- |
| [`scaffold`](journeys/scaffold.yaml) | an empty folder | set up a project, list it, check its credentials, add a phone field, enable passkeys |
| [`existing-nextjs`](journeys/existing-nextjs.yaml) | [`fixtures/todo-app`](fixtures/todo-app), a small Next.js app with no auth | add sign-up and sign-in, protect every page but home, keep the app working |

A journey with a `start` copies that fixture app into the workspace, commits it
(setup refuses a dirty tree) and installs it before the first stage.

To add a journey, add a YAML file to `journeys/`. To add a starting app, put it
under `fixtures/` and name it in `start`.

## What a stage is checked on

A stage passes on its **outcome**:

- reads against the live instance (`projects list`, `schemas get …`), and
- for stages that name one, the app driven in a real browser: register, reach a
  protected page, sign out, sign back in, a field on the form, a passkey offered
  at sign-in, a signed-out visitor stopped at a protected page.

The report counts a run where the agent finished cleanly but a check failed as a
**false completion**.

## Not a CI test

It is slow (tens of minutes), needs Docker and a Claude credential, and is
non-deterministic. It is kept out of CI and run on demand.

## Prerequisites

- **Docker** running.
- **Dependencies installed** from the repository root: `corepack pnpm install`.
- **A Claude credential**, so the agent in the container can talk to Claude. Use
  a long-lived OAuth token from your own Claude subscription:

  1. Run `claude setup-token` in a terminal. It opens a browser to sign in, then
     prints a token that starts with `sk-ant-oat`.
  2. Put it in `apps/cli-skill-e2e/.env`, which git ignores:
     ```sh
     printf 'ANTHROPIC_API_KEY=%s\n' 'sk-ant-oat-…' > apps/cli-skill-e2e/.env
     ```

  The eval reads that file by itself. To keep the token elsewhere, point
  `ENV_FILE` at a file that has it, or export `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_API_KEY`. A regular Anthropic API key works the same way. Never
  commit the token.

## Run it

With Moon, from anywhere in the repository:

```sh
moon run cli-skill-e2e:eval          # every enabled scenario × journey
moon run cli-skill-e2e:report        # rebuild the report pages from out/
moon run cli-skill-e2e:typecheck
```

Pick what runs with environment variables in front of the same command:

```sh
EVAL_SCENARIOS=sonnet EVAL_JOURNEYS=existing-nextjs moon run cli-skill-e2e:eval
EVAL_SCENARIOS=haiku,sonnet-baseline moon run cli-skill-e2e:eval
EVAL_REPEATS=3 moon run cli-skill-e2e:eval     # each run three times, side by side
LOCAL_SKILL=1 moon run cli-skill-e2e:eval      # try a skill edit before pushing it
```

Without Moon, `corepack pnpm --filter @zitadel/cli-skill-e2e eval` does the same.

A full run of one scenario takes 8 to 10 minutes and spends Claude tokens. The
first run also pulls the `node:24` image.

Scenarios are in [`scenarios.ts`](scenarios.ts): Opus and Sonnet are on; Haiku
and a Sonnet baseline (no skill) are off.

When a run ends, a reporter builds one page per journey,
`out/<journey>/journey.html`, and opens them in Chrome: one tab per stage, the
whole conversation, every command with its exit code and output, and per-scenario
verified success, false completion, median time and tokens per success. Each run
records its exact model, CLI version and skill version.

## Knobs (env)

| var | default | meaning |
| --- | --- | --- |
| `EVAL_SCENARIOS` | enabled ones | comma list of scenario names to run |
| `EVAL_JOURNEYS` | all | comma list of journey names to run |
| `EVAL_REPEATS` | `1` | how many times each scenario × journey runs |
| `EVAL_PARALLEL` | `2` | how many runs go at once; each is a container with a dev server and a browser |
| `STAGES` | all | e.g. `1,4,5`; include `1`, a journey is stateful |
| `LOCAL_SKILL` | off | `1` installs the skill from this checkout, not GitHub |
| `BRANCH` | `main` | the GitHub branch to install the skill from |
| `ENV_FILE` | `.env` | file holding `ANTHROPIC_API_KEY=…` |
| `SIM_MODEL` | Haiku 4.5 | model for the simulated developer |
| `MAX_TURNS` | `40` | per-agent-turn turn cap |
| `MAX_QA` | `6` | question/answer rounds per interactive stage |
| `OPEN_REPORT` | on | `0` to not open the reports (also off under `CI`) |
| `OUT` | `out/` | where results and reports go |

## Output

`out/<journey>/<with-skill|baseline>/<scenario>/r<N>/` holds `stage<N>.jsonl`
(the agent's stream plus a `sim_user` line per simulated answer),
`asserts-stage<N>.json` (every check with its evidence), `after-stage<N>.json`
(schema snapshots), `run.json` (the scenario, exact model, CLI and skill
versions), screenshots from the app checks and the container's logs. Everything
under `out/` is gitignored.
