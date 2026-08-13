# Console Architecture Decision Records

This directory holds architecture decision records (ADRs) **scoped to the
`apps/console` app**. They capture proposals that are local to the console SPA
(routing, API access, shell composition) and are numbered independently from
the repository-wide ADRs in [`docs/adrs/`](../../../../docs/adrs/README.md).

Statuses live in the index below; 0001 and 0002 were team-reviewed on
2026-06-30 as the agreed direction for the console build-out (issue #440),
0003 and 0004 were drafted 2026-07-23 and are pending review even though
substantial parts of both are already implemented.

When a decision affects more than the console (the server, the SDK packages,
the shared component contract), it belongs in the repo-wide
[`docs/adrs/`](../../../../docs/adrs/README.md) instead. These console ADRs
reference the repo-wide ones where they build on them.

## Index

| ID | Title | Status | Summary |
| --- | --- | --- | --- |
| [0001](0001-console-routing.md) | Routing | Accepted (2026-06-30; route tree amended 2026-08-11) | TanStack Router file-based routing; one router factory and one register augmentation; `basepath` derived from the Vite `base` (`import.meta.env.BASE_URL`); route tree for the #440 resources; data via route `loader`s with pending/error/not-found boundaries; sidebar driven by route `staticData`. |
| [0002](0002-console-api-access.md) | API access and auth interceptors | Accepted (2026-06-30) | Server-side proxy injects the project secret; the console holds no credential and sends no `Authorization` header (upholds ADR 005). Reuse `configureZitadel()` / `getApi()` and the shared `customFetch` interceptor (ADR 016) instead of a bespoke client; `ApiError` drives boundary copy; forward-looking slot for console-user auth. |
| [0003](0003-console-authentication.md) | Console authentication | Proposed (implemented; pending review) | Fills ADR 0002 §5's slot: a `/login` route embeds the `<zitadel-login>` widget via `@zitadel/sdk-react`; a pathless `_authed` layout guards every screen on `GET /sessions/me` (`__nextgen_session` cookie) and owns the shell; sign-out via `DELETE /sessions/me`; 401s redirect to login with `?next=`. The cookie authenticates the UI only — management authorization stays on the server-held project secret until root ADRs 032/033/036 land. |
| [0004](0004-console-deployment-modes.md) | Deployment modes | Proposed (standalone slice implemented; pending review) | One console artifact serves cloud (multi-project + billing portal, #555) and self-host. Standalone tracks **exactly one project** — the first-created one (the customer's `zitadel setup`) becomes the default; the server never creates it. A minimal per-request runtime document carries only `mode` + the sign-in project id; portal surfaces render from **effective permissions** (user grants ∩ deployment profile, computed server-side — ADR 032/033 vocabulary), so deployment offering and user authorization funnel through one mechanism. Platform-mode provisioning of a dedicated platform project (#527) and effective-permission exposure remain future server work. License-unlocked self-host portals are a config change, not a console change. |
