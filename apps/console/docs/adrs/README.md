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

| ID                                       | Title                                          | Status                                                  | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-console-routing.md)          | Routing                                        | Accepted (2026-06-30; route tree amended 2026-08-11)    | TanStack Router file-based routing; one router factory and one register augmentation; `basepath` derived from the Vite `base` (`import.meta.env.BASE_URL`); route tree for the #440 resources; data via route `loader`s with pending/error/not-found boundaries; sidebar driven by route `staticData`.                                                                                                                                                                                                          |
| [0002](0002-console-api-access.md)       | API access and auth interceptors               | Accepted (2026-06-30)                                   | The Console holds no project secret or script-readable bearer and sends no `Authorization` header. The embedded browser carries its HttpOnly first-party session cookie; the Vite dev proxy may temporarily inject a project secret. Reuse `configureZitadel()` / `getApi()` and the shared `customFetch` interceptor (ADR 016); `ApiError` drives boundary copy.                                                                                                                                               |
| [0003](0003-console-authentication.md)   | Console authentication                         | Proposed (implemented; pending review)                  | A `/login` route embeds the `<zitadel-login>` widget via `@zitadel/sdk-react`; a pathless `_authed` layout guards every screen on `GET /sessions/me` (`__nextgen_session` cookie) and owns the shell; sign-out uses `DELETE /sessions/me`; 401s redirect to login with `?next=`. The HttpOnly first-party cookie is the embedded Console's human credential; root ADR 054 resolves its target-project authority, while the dev proxy secret remains a temporary implementation bridge.                          |
| [0004](0004-console-deployment-modes.md) | Deployment modes and control-project bootstrap | Proposed (standalone slice implemented; pending review) | One Console artifact and one authorization model serve cloud and self-host. Every deployment explicitly seeds a fully provisioned reserved platform project for Console identities; the testkit may supply the seed now and a later server file may supply the same desired state. Standalone optimizes for one customer project but permits more. Runtime metadata carries only the public Console sign-in target; project access remains target-scoped and portal surfaces render from effective permissions. |
