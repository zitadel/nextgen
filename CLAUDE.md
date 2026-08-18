# Claude Code Instructions

Tool-specific rules in this file are a bootstrap only.

Authoritative instructions live in scoped `AGENTS.md` files.

Always read in this order:

1. Root `AGENTS.md`
2. The nearest scoped `AGENTS.md` for the files you read or change

Start with:

- [AGENTS.md](AGENTS.md)
- [internal/storage/AGENTS.md](internal/storage/AGENTS.md)
- [apps/cli-journey-e2e/AGENTS.md](apps/cli-journey-e2e/AGENTS.md)

Minting a resource ID? Never write custom ULID/UUID helpers — the canonical
minting contract lives in
[internal/storage/AGENTS.md](internal/storage/AGENTS.md) (context:
[ADR 047](docs/adrs/047-dialect-id-generation.md)).

Building console or design-system UI (from Figma or otherwise)? Classify the
component before building — do not reverse-engineer a flattened app mock. The
3-way decision and token authority live in
[apps/console/docs/styling.md](apps/console/docs/styling.md); the Figma→pair
recipe and parity gate in [apps/storybook/AGENTS.md](apps/storybook/AGENTS.md).

Developing the console? Use `moon run console:dev-real` — it boots a seeded real
instance, because the console manages an instance and its list screens are only
honest against real data. See [apps/console/AGENTS.md](apps/console/AGENTS.md).

Changing the login flow, its atoms, or the orchestrator? The flow definition in
[packages/config/defaults/default-login.json](packages/config/defaults/default-login.json)
is the authority for step shape — `@zitadel/api-mock` mirrors it, and a fixture
must be diffed against it before being changed
([packages/api-mock/AGENTS.md](packages/api-mock/AGENTS.md)).

## Personal setup lives outside this file

This file is checked in and shared. Per-developer rules — which GitHub account
to use, whether an agent may push, editor preferences — belong in your own
`~/.claude/CLAUDE.md`, not here.

Some contributors also keep local skills in `.claude/skills/` (gitignored), e.g.
a `console-design-system-ui` classify-before-build guardrail and a
`zitadel-pr-template` helper. They are conveniences layered on the docs linked
above; nothing in this repo depends on them, so don't assume they are present.
