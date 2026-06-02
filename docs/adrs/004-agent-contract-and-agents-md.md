# ADR 004: Agent Contract and AGENTS.md

> **Status:** Proposed
> **Date:** 2026-04-26
> **Context:** Machine-readable CLI DevEx

## Decision

`apps/cli/AGENTS.md` is the canonical generated agent contract. The CLI package does not ship tool-specific mirrors; agents and humans should point to `AGENTS.md`.

Agents should call `zitadel <command> --non-interactive --json`, parse the JSON envelope, and prefer `next_commands` over prose hints.

## Context

The CLI is part of the product surface for AI coding agents. Agents need stable discovery, strict envelopes, explicit support status, and honest mock behavior.

## Consequences

- `apps/cli/AGENTS.md`, generated from the command registry, is the source of truth; `zitadel help --json` exposes the same registry at runtime.
- Golden-path commands are marked supported.
- Half-built surfaces stay callable only when marked experimental.
- Failed commands must emit parseable JSON on stdout without stray text.
