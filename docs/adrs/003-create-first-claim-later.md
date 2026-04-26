# ADR 003: Create First, Claim Later

> **Status:** Proposed
> **Date:** 2026-04-26
> **Context:** AI-native Zitadel CLI onboarding

## Decision

Zitadel setup starts in **pre-claim** mode: a developer or agent can create local auth configuration and run a mock/dev flow before the human signs up. Claim is a later human handoff that attaches the project to an accountable team.

Agents may initiate claim and return a `claim_url`, but they do not complete claim. The CLI exposes `zitadel claim status` so a completed human handoff can refresh local state and unblock production apply.

## Context

Modern agent-driven setup breaks when the first step is a browser signup, email verification loop, or billing screen. The CLI should let agents finish the local integration and then stop at the accountability boundary.

## Consequences

- The golden path is fast: `setup` creates local config, schema, flow, locale, env metadata, and framework routes.
- Pre-claim projects are suitable for local development only.
- Production apply requires claimed local state.
- Recovery before claim is best-effort; claim early when ownership matters.

