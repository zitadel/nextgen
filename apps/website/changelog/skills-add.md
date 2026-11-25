---
title: Give your coding agents Zitadel's skills with zitadel skills add
summary: zitadel skills add adds the Zitadel skills of the CLI version you run to your project, for Claude Code, Cursor, Copilot, Codex and other skills-compatible agents.
date: 2026-11-01T21:16Z
pulls: [2487]
---

`zitadel skills add` gives your project's coding agents the Zitadel skills of the CLI version you run, so their guidance matches it: the `zitadel` router skill, the CLI skill, and the skills for each framework's SDK and the components. They land in `.agents/skills/`, and in `.claude/skills/` for Claude Code. The note after `zitadel setup` now names the command.

```sh
npx @zitadel/cli@latest skills add
```

Run it again after updating the CLI to keep them in step. To install them from the repository's `main` instead, run `npx skills add zitadel/nextgen --full-depth`.

[Agent setup](https://preview.zitadel.com/docs/get-started/agents), [zitadel skills add](https://preview.zitadel.com/docs/reference/cli/skills/add)
