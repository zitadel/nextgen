---
applyTo: "apps/cli/**"
---

# CLI Review Instructions

The CLI is an agent-facing product surface. Review changes against
`apps/cli/SKILLS.md`, `apps/cli/README.md`, and the oclif command metadata.

- Commands used by agents must support `--non-interactive --json` and return a
  parseable JSON envelope without stray stdout text.
- For local JSON capture, prefer
  `corepack pnpm --silent run cli -- ... --json`; plain `pnpm run` prints its
  own script prelude before CLI stdout.
- Keep `commands --json`, help output, README command docs, and `SKILLS.md` in
  sync with behavior and tests.
- Prefer structured `next_commands` and stable error codes over prose-only
  guidance.
- Do not reintroduce the removed pre-claim / claim lifecycle unless a real
  server contract lands first.
- Changes to command names, flags, envelope shape, server resolution, renderer
  direction, or agent guidance should update tests, `apps/cli/SKILLS.md`, and
  the generated README command section.
- Mock behavior should be explicit and must not be presented as live platform
  behavior.
