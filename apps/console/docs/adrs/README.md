# Console Architecture Decision Records

This directory holds architecture decision records (ADRs) **scoped to the
`apps/console` app**. They capture proposals that are local to the console SPA
(routing, API access, shell composition) and are numbered independently from
the repository-wide ADRs in [`docs/adrs/`](../../../../docs/adrs/README.md).

Both ADRs below are **Accepted** (team-reviewed, 2026-06-30) and are the agreed
direction for the upcoming console build-out (issue #440).

When a decision affects more than the console (the server, the SDK packages,
the shared component contract), it belongs in the repo-wide
[`docs/adrs/`](../../../../docs/adrs/README.md) instead. These console ADRs
reference the repo-wide ones where they build on them.

## Index

| ID | Title | Summary |
| --- | --- | --- |
| [0001](0001-console-routing.md) | Routing | TanStack Router file-based routing; one router factory and one register augmentation; `basepath` derived from the Vite `base` (`import.meta.env.BASE_URL`); route tree for the #440 resources; data via route `loader`s with pending/error/not-found boundaries; sidebar driven by route `staticData`. |
| [0002](0002-console-api-access.md) | API access and auth interceptors | Server-side proxy injects the project secret; the console holds no credential and sends no `Authorization` header (upholds ADR 005). Reuse `configureZitadel()` / `getApi()` and the shared `customFetch` interceptor (ADR 016) instead of a bespoke client; `ApiError` drives boundary copy; forward-looking slot for console-user auth. |
