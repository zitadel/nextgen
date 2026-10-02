---
"@zitadel/cli": minor
---

Ship the CLI's agent contract as an installable Agent Skill. The guidance moves from `apps/cli/SKILLS.md` to `apps/cli/skills/zitadel-cli/SKILL.md`, with the detailed resource, command, and login-driving material split into progressive-disclosure `references/` files, conforming to the open Agent Skills format (agentskills.io). The skill ships inside the `@zitadel/cli` tarball, and any skills-compatible agent can install it with `npx skills add zitadel/nextgen` — fanning out to Claude Code, Cursor, Copilot, Codex, and the wider ecosystem.
