# cli-skill-eval

An **agent eval** for the `zitadel-cli` Agent Skill. It does not test the CLI's
commands (those have their own unit/e2e tests) — it checks whether an agent that
only has the skill can answer **common developer questions sanely**: the right
command, few turns, low tokens.

It runs Claude Code headless (`claude -p`) in a clean container, with the skill
installed exactly as a user would get it (`npx skills add`), across a single
stateful journey (one project flows through every stage). The stages live in
[`journey.config.json`](journey.config.json) — adding a question is a data edit.

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

```sh
# reuse captured results (instant) — grade + open the report window
ENV_FILE=./.secret.env moon run cli-skill-eval:test

# re-run the containers from scratch (tens of minutes), then grade + open
ENV_FILE=./.secret.env moon run cli-skill-eval:eval
# or:  ENV_FILE=./.secret.env FRESH=1 pnpm vitest run
```

Vitest runs the eval in `globalSetup`, asserts each **with-skill** stage reached
its goal (the baseline is captured for comparison, not asserted), then in
`teardown` renders `out/journey.html` and opens it in your browser.

## Knobs (env)

| var | default | meaning |
| --- | --- | --- |
| `ENV_FILE` | — | file containing `ANTHROPIC_API_KEY=…` (recommended) |
| `FRESH` | `0` | `1` re-runs the containers instead of reusing `out/` |
| `BRANCH` | `feat/cli-installable-agent-skill` | which branch's skill to install |
| `MODEL` | `sonnet` | model for the driving agent |
| `MAX_TURNS` | `40` | per-stage turn cap |

## Output

`out/<config>/stage<N>.jsonl` (trajectories), `out/<config>/after-stage<N>.json`
(schema snapshots), `out/journey.html` (the tabbed report: one tab per stage,
every command with its output, per-stage tokens). Everything under `out/` is
gitignored.
