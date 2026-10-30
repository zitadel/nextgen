# ADR 085: Which Release Serves a Request

> **Status:** Accepted
> **Date:** 2026-10-29
> **Builds on:** [ADR 035](035-configuration-environments.md) (releases and
> deployments), [ADR 036](036-api-credential-planes.md) (origins),
> [ADR 066](066-operation-policies.md) (policies) and
> [ADR 068](068-project-is-the-data-boundary.md) (a target serves its newest
> deployment).
> **Implemented by:** #2393, #2465, #2469, #2535, #2394.

## Context

A release pins one revision of each piece of a project's configuration, and a
deployment makes it live on targets. A request with no `Origin`, a release that
pinned no flow and an origin with nothing deployed all fell back to the newest
stored revisions, so one sign-in could mix deployed and undeployed
configuration.

## Decision

### Every request is served one release, or refused

Opening a flow takes four steps:

1. Check the origin ([ADR 036](036-api-credential-planes.md)). The `Origin` must
   be a primary origin of the project, a live preview URL or a loopback origin.
   Anything else answers `403` with `proj.origin_not_allowed` or
   `proj.preview_not_live`. The console's origins (`server.public_base`'s and
   `server.console_origins`) can open any project's flow, but cannot take a
   later step.
2. Pick the target. That is the exact origin, or `default` for a request with
   no `Origin` and for a console origin the project does not list.
3. Find the target's newest deployment. With none, the request answers `409`:
   `rel.not_deployed` for an origin, `rel.no_default` for `default`.
4. Serve that deployment's release. If it was revoked, the request answers `409`
   with `rel.revoked`.

`setUserPassword` and `createAuthAttempt` do not come from a browser page, so
they target `default` and ignore `Origin`.

### A flow keeps its release

A flow stays on the release it opened with, even after a newer deployment. If
that release is revoked, a later step or the session exchange answers `409` with
`rel.revoked`.

### The release is the only source

A request reads only the revisions its release pins. When the release pins no
flow or policy, there is none to run or apply, and when it pins no branding the
login uses the built-in one. Creating a flow definition and building a release
still read the newest revisions, because no release serves them.

### Every project has a release

- `zitadel setup` deploys `.zitadel/` once the app is scaffolded and committed.
- `zitadel deploy` and the console deploy to the primary origins and `default`,
  so callers with no `Origin` run what the web origins run.
- With platform bootstrap on, every start makes `server.public_base`'s origin
  the platform project's one primary origin and deploys the configuration the
  server ships to it and `default`. A start that changes nothing deploys
  nothing, and a server older than the live release's leaves it alone.

## Consequences

- An edit to `.zitadel/` reaches sign-in only through a deploy.
- One app reached at two origins, such as `localhost` and `127.0.0.1`, is two
  targets, and each needs its own deployment.
- The console's login preview of a project it does not list shows the `default`
  deployment, so undeployed drafts stay out of it.
- Signing in to the console from a hosted deployment's own URL is not covered:
  it would need a preview pattern and a preview deploy at each start.

## Rejected alternatives

- Serving the newest revisions while nothing is deployed brings back the mixing
  described above.
- A special rule admitting the console's origins for the platform project would
  make it the one project not served through its own origins and deployments.
- Deploying the platform project once, at deploy time, would leave a local
  `zitadel start` or a self-hosted server with nothing deployed.
