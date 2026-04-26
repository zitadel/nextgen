# ADR 007: GitOps Configuration Surface

> **Status:** Proposed
> **Date:** 2026-04-26
> **Context:** Local Zitadel project configuration

## Decision

Repo files describe configuration; server APIs own runtime resources. The CLI writes `zitadel.json` and `.zitadel/**` config files, then `zitadel plan` and `zitadel apply` validate and upload the config bundle.

Local secrets are excluded from source control. Resource-like POC commands such as IdP and app management are marked experimental until their server contracts are real.

## Context

Agents work best when they can inspect and edit deterministic files. Humans work best when auth changes can be reviewed like code.

## Consequences

- Config drift is visible through plan/apply.
- Flow, schema, locale, and template files are reviewable.
- Generated examples avoid fake providers or deprecated vocabulary.
- Runtime data such as users, sessions, tokens, and audit events remains out of the repo.
