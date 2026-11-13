# Agent Instructions — `apps/cli/src/lib/orca`

Package rules: [`../../../AGENTS.md`](../../../AGENTS.md).

## `patchers/` is not the CLI's own code

A patcher edits the customer's files (a Vite config, a root component, a
layout) and drops template text into their project. Its scanners read the
customer's source, and its templates become the customer's source. None of it
runs as the CLI's own control flow, so the CLI's code style does not apply to it.

- Never edit anything under `patchers/` to satisfy a style, lint or
  immutability rule: no `let` removal, no `readonly` sweeps, no reduce or
  recursion rewrites of a scanner, no template-string cleanup.
- `biome-plugins/no-let.grit` exempts `src/lib/orca/patchers` on purpose; never
  narrow that exemption or add a `biome-ignore` there to satisfy it.
- Change a file here only for what the patcher does to a customer's project,
  with a unit test of the output it writes.
- A scanner's edge cases (unbalanced brackets, quotes, escapes) are pinned by
  its tests; a rewrite that is not a behaviour change has no reason to exist.
- Treat a sweep that touches this directory as a mistake and revert it: brief
  every agent and subagent with this rule, because a repo-wide refactor reaches
  here first.
