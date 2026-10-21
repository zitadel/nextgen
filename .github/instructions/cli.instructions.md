---
applyTo: "apps/cli/**"
---

# CLI Review Instructions

The CLI is an agent-facing product surface. Canonical sources:
[`apps/cli/AGENTS.md`](../../apps/cli/AGENTS.md) (package rules),
[`apps/cli/skills/zitadel-cli/SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md)
(the agent contract) and
[`apps/cli/src/lib/local-server/AGENTS.md`](../../apps/cli/src/lib/local-server/AGENTS.md)
(the local runtime commands). Review heuristics on top of those:

- The claim lifecycle is shipped
  ([ADR 046](../../docs/adrs/046-claim-lifecycle-v2.md)); do not request its
  removal.
- A change to command names, flags, envelope shape, server resolution, scaffold
  posture ([ADR 042](../../docs/adrs/042-scaffolded-file-ownership-and-drift-detection.md)/
  [043](../../docs/adrs/043-framework-version-floors.md)/
  [044](../../docs/adrs/044-scaffold-embedding-posture-defaults.md)) or agent
  guidance must update tests, `SKILL.md` and the generated README command
  section together; flag one that moves only some of them.
- Mock behavior must be explicit and must not be presented as live platform
  behavior.
