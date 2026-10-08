# cli-skill-e2e

An **agent eval** for the `zitadel-cli` Agent Skill. It does not test the CLI's
commands (those have their own unit/e2e tests) — it checks whether an agent that
only has the skill can answer **common developer questions sanely**: the right
command, few turns, low tokens.

It runs Claude Code headless (`claude -p`) in a clean container, with the skill
installed exactly as a user would get it (`npx skills add`), across a single
stateful journey (one project flows through every stage). The stages live in
[`journey.config.json`](journey.config.json) — adding a question is a data edit.

**Grading is outcome-first.** After each stage, the harness asks the *live local
instance* what it actually holds — via the CLI's own read commands (`--json`) —
and checks the stage's declared `assert` list against that. A stage passes only
when reality matches, so "edited the file but never deployed", a no-op, or a
confident-but-wrong answer all fail. Each assertion is
`{ name, get, path, op, value }`: `get` is a read command, `path` points into its
JSON, `op` is `exists` / `eq` / `neq` / `count-eq` / `count-gte`. A stage with no
server-assertable outcome (e.g. "is this a client id?") falls back to a
transcript check via its `grade` rule.

**"Non-interactive" means the CLI, not the agent.** The agent always drives the
CLI with `--non-interactive --json`, but it may still converse with the
developer. A stage with a `user` persona is run as a **multi-turn conversation**:
the agent prompts (e.g. "which sign-in methods? which profile fields?") and a
*simulated user* — a cheap, skill-less Claude answering from that persona —
replies, until the agent is done or the Q&A cap is hit. A stage with no persona
is a single agent turn. The driver is [`scripts/drive.mjs`](scripts/drive.mjs).

## Not a CI test

This is slow (tens of minutes), needs Docker and a Claude credential, and is
non-deterministic (an LLM drives it). It is intentionally kept **out of CI**
(`runInCI: false`) and run on demand.

## Prerequisites

- **Docker** running.
- **A Claude credential.** Mint a long-lived token once:
  ```sh
  claude setup-token      # prints sk-ant-oat-…
  printf 'ANTHROPIC_API_KEY=%s\n' 'sk-ant-oat-…' > ./.secret.env   # gitignored
  ```
  (Or export `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` in your shell.)

## Run it

This is a standalone pnpm workspace, not a Moon project (keeping it out of the
Moon graph means a run here never forces the whole repo's CI graph to rebuild).
Invoke it with pnpm:

```sh
# reuse captured results (instant) — grade + open the report window
ENV_FILE=./.secret.env pnpm --filter @zitadel/cli-skill-e2e test

# re-run the containers from scratch (tens of minutes), then grade + open
ENV_FILE=./.secret.env pnpm --filter @zitadel/cli-skill-e2e eval
# or:  ENV_FILE=./.secret.env FRESH=1 pnpm --filter @zitadel/cli-skill-e2e exec vitest run
```

Vitest runs the eval in `globalSetup`, asserts each **with-skill** stage reached
its goal (the baseline is captured for comparison, not asserted), then in
`teardown` renders `out/journey.html` and opens it in your browser.

## Knobs (env)

| var | default | meaning |
| --- | --- | --- |
| `ENV_FILE` | — | file containing `ANTHROPIC_API_KEY=…` (recommended) |
| `FRESH` | `0` | `1` re-runs the containers instead of reusing `out/` |
| `BRANCH` | `main` | which branch's skill to install |
| `MODEL` | `sonnet` | model for the driving agent |
| `SIM_MODEL` | `haiku` | model for the simulated user answering the agent |
| `MAX_TURNS` | `40` | reasoning-loop cap per `claude -p` call (with-skill) |
| `BASELINE_MAX_TURNS` | `5` | tighter loop cap for the baseline (no-skill) config |
| `MAX_QA` | `6` | max question/answer rounds per interactive stage (with-skill only) |
| `CALL_TIMEOUT_MS` | `420000` | wall-clock timeout per `claude -p` call (anti-hang) |
| `CLI_SPEC` | `@zitadel/cli@alpha` | the CLI package/tag used to read live state for assertions |

**Two safeguards keep a run from dragging or hanging.** `MAX_TURNS` caps the
*reasoning loop* (how many model↔tool steps a call may take); `CALL_TIMEOUT_MS`
caps *wall-clock time*, killing a call that stalls inside a single turn (a wedged
network call, a stuck child) — something a turn cap can't catch.

The baseline is deliberately starved: a tight 5-turn cap and **no simulated-user
Q&A** (one short attempt, not five rounds of the user spelling out requirements
it can't act on). And because the journey is stateful, the driver **aborts the
remaining stages** the moment a stage leaves no project behind (the baseline's
usual fate). Together that turns the baseline from minutes of flailing into a
single, fast, failed setup stage; the skipped stages have no trajectory file and
grade as failures.

## Output

`out/<config>/stage<N>.jsonl` (trajectories — the agent's stream-json plus a
`{"type":"sim_user",…}` line per simulated-user answer), `out/<config>/after-stage<N>.json`
(schema snapshots), `out/<config>/asserts-stage<N>.json` (each stage's
live-instance assertion results — `{name, passed, evidence}`), `out/journey.html`
(the tabbed report: one tab per stage, the full conversation — prompt, what the
agent asked, what the user answered, every command with its output, the
live-instance checks, per-stage tokens). Everything under `out/` is gitignored.
