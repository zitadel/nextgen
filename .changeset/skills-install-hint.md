---
"@zitadel/cli": minor
---

Show a one-time banner, at the top of `zitadel` and `zitadel setup`, when AI coding agents (Claude Code, Cursor, Gemini CLI, and others) are detected, telling the developer to run `npx skills add zitadel/nextgen --full-depth` to give them the Zitadel skills. The CLI installs nothing itself. The banner is skipped in CI, with `--json` or `--non-interactive`, and when `NO_SKILLS_PROMPT` is set.
