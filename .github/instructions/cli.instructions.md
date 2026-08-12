---
applyTo: "apps/cli/**"
---

# CLI Review Instructions

The CLI is an agent-facing product surface. Canonical sources, in order:
[`apps/cli/AGENTS.md`](../../apps/cli/AGENTS.md) (scope pointers + telemetry
rules), [`apps/cli/SKILLS.md`](../../apps/cli/SKILLS.md) (the agent contract),
and the root [`AGENTS.md` — CLI Contract](../../AGENTS.md#cli-contract)
(JSON envelope). Review pointers on top of those:

- The command surface is `apply`, `branding eject`, `claim`, `doctor`,
  `eject`, `logs`, `plan`, `reset`, `schemas list`, `setup`, `start`,
  `status`, `stop` — `setup` supports 8 frameworks. The claim lifecycle is
  shipped ([ADR 046](../../docs/adrs/046-claim-lifecycle-v2.md)); do not
  request its removal.
- Changes to command names, flags, envelope shape, server resolution,
  scaffold posture ([ADR 042](../../docs/adrs/042-scaffolded-file-ownership-and-drift-detection.md)/
  [043](../../docs/adrs/043-framework-version-floors.md)/
  [044](../../docs/adrs/044-scaffold-embedding-posture-defaults.md)), or agent
  guidance must update tests, `SKILLS.md`, and the generated README command
  section together.
- `--server local` must resolve through `.zitadel/local/runtime.json` only
  when the local runtime is healthy, otherwise return a stable
  `E_LOCAL_SERVER_NOT_RUNNING` envelope.
- Mock behavior should be explicit and must not be presented as live platform
  behavior.
