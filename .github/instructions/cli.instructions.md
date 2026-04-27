---
applyTo: "apps/cli/**"
---

# CLI Review Instructions

The CLI is an agent-facing product surface. Review changes against the generated
contract in `apps/cli/AGENTS.md` and the command registry.

- Commands used by agents must support `--non-interactive --json` and return a
  parseable JSON envelope without stray stdout text.
- Keep `capabilities --json`, `help --json`, and command registry metadata in
  sync with behavior and tests.
- Prefer structured `next_commands`, stable error codes, and honest
  `agent_status` values over prose-only guidance.
- Do not complete the human claim handoff. `zitadel claim` returns a
  `claim_url`; `claim status` only refreshes local state after the human acts.
- Changes to command names, flags, envelope shape, server resolution, renderer
  direction, or claim behavior should update tests and regenerate
  `apps/cli/AGENTS.md` with `corepack pnpm --filter zitadel gen:agents-md`.
- Mock behavior should be explicit and must not be presented as live platform
  behavior.
