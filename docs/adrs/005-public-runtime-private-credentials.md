# ADR 005: Public Runtime and Private Credentials

> **Status:** Proposed
> **Date:** 2026-04-26
> **Context:** Browser-safe SDK runtime

## Decision

Browser-rendered auth components receive only public runtime metadata: project ID, environment, issuer, and flow purpose. Project and preview secrets remain in `.zitadel/secret`, CLI flows, server-side code, or deployment-provider secret stores.

The React shim exposes `ZitadelFlow` with the same vocabulary as the future `<zitadel-flow>` web component.

## Context

Next client components cannot safely depend on private environment variables. Prefixing project secrets for browser access would leak bearer credentials.

## Consequences

- Generated pages pass public metadata into `ZitadelFlow`.
- Development may render mock auth.
- Preview and production must resolve runtime metadata or show a blocking error.
- Secret-bearing operations stay in CLI/server boundaries.
