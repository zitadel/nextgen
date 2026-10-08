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

## Amendment (2026-10-08): no environment in the public runtime metadata

The public runtime metadata a browser component receives is the project id,
the issuer and the flow purpose. There is no environment to send
([ADR 068](068-project-is-the-data-boundary.md)); which release serves the
component follows from the origin the page runs on. The rule stands: nothing
private reaches the browser.
