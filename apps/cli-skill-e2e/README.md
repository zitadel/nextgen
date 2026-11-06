# cli-skill-e2e

An **agent eval** for the `zitadel-cli` Agent Skill. It does not test the CLI's
commands (those have their own tests). It checks whether an agent that only has
the skill can get working auth into an app: the right commands, few turns, low
tokens, and an outcome that holds up when the live instance and the scaffolded
app are asked, whatever the agent said.

## How it runs

Each scenario (a model, with or without the skill) is one Vitest project that
runs the whole journey as a stateful conversation, one `it` per stage:

- **The test runs on the host.** It owns the temp directory, the simulated
  developer's turns, the checks and the grading.
- **The agent runs in a container.** A small HTTP server inside it
  ([`scripts/agent-server.mjs`](scripts/agent-server.mjs)) runs the agent's
  turns, the simulated developer, the CLI reads and the browser checks. The
  test speaks to it over HTTP on a loopback port, with a per-run token.
- **The journey is data.** [`journey.yaml`](journey.yaml) holds the prompts, the
  developer persona and what each stage must leave behind. Adding a question is
  a YAML edit.

"Non-interactive" describes how the agent drives the CLI, not the agent's
conversation with the developer. A stage with a `user` persona is a real
conversation: the agent asks, a cheap simulated developer answers from the
persona, until the agent is done or the question cap is hit.

## What a stage is checked on

A stage passes on its **outcome**:

- reads against the live instance (`projects list`, `schemas get …`), and
- for the stages that name one, the scaffolded app driven in a real browser:
  register, reach the protected page, sign out, sign back in, a field on the
  form, a passkey offered at sign-in.

The report counts a run where the agent finished cleanly but a check failed as a
**false completion**.

## Not a CI test

It is slow (tens of minutes), needs Docker and a Claude credential, and is
non-deterministic. It is kept out of CI and run on demand.

## Prerequisites

- **Docker** running.
- **A Claude credential.** Mint a long-lived token once and keep it out of git:
  ```sh
  claude setup-token      # prints sk-ant-oat-…
  printf 'ANTHROPIC_API_KEY=%s\n' 'sk-ant-oat-…' > ./.secret.env
  ```
  Or export `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`.

## Run it

```sh
pnpm --filter @zitadel/cli-skill-e2e eval      # every enabled scenario
```

The scenarios live in [`scenarios.ts`](scenarios.ts): Opus and Sonnet are on;
Haiku and a Sonnet baseline (no skill) are off. Run others by name, or just one:

```sh
EVAL_SCENARIOS=sonnet pnpm --filter @zitadel/cli-skill-e2e eval
EVAL_SCENARIOS=haiku,sonnet-baseline pnpm --filter @zitadel/cli-skill-e2e eval
```

When a run ends, a reporter builds `out/journey.html` (the tabbed report: one
tab per stage, the whole conversation, every command with its exit code and
output, per-scenario success, false-completion and token figures) and opens it
in Chrome. `pnpm report` rebuilds it from what is already in `out/`.

## Knobs (env)

| var | default | meaning |
| --- | --- | --- |
| `EVAL_SCENARIOS` | enabled ones | comma list of scenario names to run |
| `STAGES` | all | e.g. `1,4,5`; include `1`, the journey is stateful |
| `LOCAL_SKILL` | off | `1` installs the skill from this checkout, not GitHub |
| `BRANCH` | `main` | the GitHub branch to install the skill from |
| `ENV_FILE` | `.secret.env` | file holding `ANTHROPIC_API_KEY=…` |
| `SIM_MODEL` | Haiku 4.5 | model for the simulated developer |
| `MAX_TURNS` | `40` | per-agent-turn turn cap |
| `MAX_QA` | `6` | question/answer rounds per interactive stage |
| `OPEN_REPORT` | on | `0` to not open the report (also off under `CI`) |
| `OUT` | `out/` | where results and the report go |

## Output

`out/<with-skill|baseline>/<scenario>/r1/` holds `stage<N>.jsonl` (the agent's
stream plus a `sim_user` line per simulated answer), `asserts-stage<N>.json`
(every check with its evidence), `after-stage<N>.json` (schema snapshots),
`run.json` (the scenario and exact model), screenshots from the app checks and
the container's logs. Everything under `out/` is gitignored.
