# ADR 005: Public Runtime and Private Credentials

> **Status:** Accepted — 2026-10-24 (originally Proposed 2026-04-26)
> **Date:** 2026-04-26
> **Context:** Browser-safe SDK runtime
>
> **Amendment (2026-10-24):** the rule holds: the browser gets the project ID,
> and `ZITADEL_PROJECT_SECRET` and `.zitadel/secret` stay server-side and in the
> CLI. [ADR 036](036-api-credential-planes.md) restates it. Two names below are
> out of date: the React SDK exports `ZitadelLogin`, `ZitadelLogout` and
> `ZitadelSession`, not `ZitadelFlow`
> ([ADR 055](055-lit-only-login-surface.md)), and there is no environment to
> pass since [ADR 068](068-project-is-the-data-boundary.md).

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
