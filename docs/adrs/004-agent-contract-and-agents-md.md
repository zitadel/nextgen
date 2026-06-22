# ADR 004: CLI Agent Contract and SKILLS.md

> **Status:** Proposed
> **Date:** 2026-04-26
> **Context:** Machine-readable CLI DevEx

## Decision

`apps/cli/SKILLS.md` is the canonical CLI agent guidance. The CLI package does
not ship multiple tool-specific mirrors; agents and humans should point to
`SKILLS.md`.

Agents should call `zitadel <command> --non-interactive --json`, parse the JSON envelope, and prefer `next_commands` over prose hints.

## Context

The CLI is part of the product surface for AI coding agents. Agents need stable discovery, strict envelopes, explicit support status, and honest mock behavior.

## Consequences

- `apps/cli/SKILLS.md` is the source of truth for agent invocation rules;
  `zitadel commands --json` and command help expose runtime command metadata.
- Golden-path commands are marked supported.
- Half-built surfaces stay callable only when marked experimental.
- Failed commands must emit parseable JSON on stdout without stray text.
