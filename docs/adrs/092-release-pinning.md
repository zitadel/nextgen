# ADR 092: Release Pinning

> **Status:** Proposed
> **Date:** 2026-11-25
> **Context:** [#1635](https://github.com/zitadel/nextgen/issues/1635): a
> build of the customer's app keeps the sign-in configuration it was built
> against. Implemented by #1636 (contract), #1310 (server), #1580 (SDKs and
> CLI) and #1581 (events).
> **Related:** [ADR 035](035-configuration-environments.md),
> [ADR 036](036-api-credential-planes.md),
> [ADR 048](048-wide-events-internal-audit-primitive.md),
> [ADR 049](049-events-api-retention-export.md),
> [ADR 066](066-operation-policies.md),
> [ADR 081](081-customer-hosted-login-and-oidc-provider.md)

## Context

- A sign-in is served the release of the newest deployment to the request's
  `Origin`. The app's code and its sign-in configuration ship separately, so
  they fall out of step when:
  - the app is rolled back on its host and the configuration is not;
  - a tab keeps running the previous bundle after a deploy (Vercel calls the
    window skew protection);
  - a preview branch is pushed twice and a tab is still open on the first push.
- A build knows which release it was built against: `zitadel deploy` and
  `zitadel preview` print it. Nothing lets the build ask for it.
- The flow cookie and the authentication attempt already seal the deployment
  a sign-in started on, so one sign-in never switches mid-way. Only the next
  sign-in does.

## Decision

### 1. A build pins a release with `X-Zitadel-Release`

The header names one release of the project. The server reads it only after
`Origin` has picked a target, as it does without a pin, and serves the newest
deployment of the pinned release to that origin.

- A pin selects among what was deployed to the origin. It never deploys a
  release and never admits an origin: the origin gate runs first.
- The lookup reads the deployment history, not the live view, so a release the
  origin no longer serves is still found.
- The newest deployment of the release wins, so a variables-only redeploy of
  it reaches pinned builds.
- The flow cookie and the attempt seal the pinned deployment like any other.
  Later steps send no header.

| Case | Answer |
| --- | --- |
| deployed to the origin, not revoked | served |
| never deployed to the origin | `409 rel.not_deployed`, details `{origin, release}` |
| no `Origin`, or the console's origin the project does not list | `409 rel.not_deployed`, details `{release}` |
| revoked | `409 rel.revoked` |
| not a release of the project | `404 rel.not_found` |
| not a release ID | `400 rel.reference_invalid` |

### 2. The header names a release by its ID

- The value is the release ID, `rel_…`. One function reads it; a later form is
  added there and nowhere else.
- The spec gives the header no pattern. Generated clients and the SDKs forward
  the value unread, so a later form needs no client release, and the server's
  own code answers a malformed one with `rel.reference_invalid`.
- The content digest (`content_hash`) is not accepted. It hashes revision
  pointers, which are per project, so it adds nothing an ID does not; a digest
  over revision content is the form that would add something (§Alternatives).

### 3. Only operations that resolve a deployment declare the header

`createFlow` and `setUserPassword` resolve a deployment from `Origin`; every
later step runs on the sealed one. The generated server builds the CORS
preflight's allowed headers from each operation's declared headers, so the
header is declared where it is read, and the SDKs send it on `createFlow`
alone. The OAuth and OIDC endpoints ignore it (ADR 081 §10).

### 4. A pin without a target is refused

A request with no `Origin` is served the project's newest primary deployment.
A pinned one is refused instead: serving the default would switch
configuration silently, which is what pinning exists to prevent. A
server-side pin for callers with no origin stays open on #1616.

### 5. Revocation is the only control

A release stays pinnable until it is revoked. Nothing ages it out.

### 6. Events name the deployment that served them

Every event emitted while a deployment serves a request carries
`deployment_id`, `release_id` and `target` (the origin the server checked),
and `GET /events` filters by `release_id` and `deployment_id`. A pinned
request records the pinned release, so the events of two releases served side
by side, such as the two variants of an A/B test of the sign-in, read apart.

## Consequences

### The header is not a credential

Anyone can send `X-Zitadel-Release` from browser developer tools or `curl`,
with any release ID. A pin cannot reach a release never deployed to the
request's origin, another project's release, or a revoked one. Every release
ever deployed to the origin, though, stays selectable until it is revoked,
including one replaced because it was less secure. A forged pin brings back
that release's configuration for one sign-in:

- a weaker password policy, since the pinned release's policies apply to
  sign-up and password changes;
- a flow from before a second factor was required;
- an identity provider that was removed, or a test provider;
- old branding.

### Revoking has costs

The documented practice is to revoke superseded releases after every deploy
that tightens security. That costs:

- **One release at a time.** Tightening security in the fiftieth release
  leaves the forty-nine before it pinnable until each is revoked.
- **No way back.** A revoked release cannot be deployed or rolled back to.
- **Pinned builds break.** Their next sign-in gets `rel.revoked` until they are
  rebuilt or reloaded; the SDKs surface the code so the app can say so.
- **Order.** `rel.in_use` refuses a release an origin still serves, so the
  replacement deploys first. A deploy racing a revoke is not serialised yet
  (#2206).

### Other consequences

- A configuration fix reaches pinned builds only after they are rebuilt, or
  after the release they pin is revoked. Serving by origin stays the default
  for this reason.
- Native and mobile apps should not pin: a release ID in a store binary stays
  there for months.
- A build that pins on one project's origin cannot be promoted to another
  project's origin: the release ID is per project.

## Alternatives considered

- **A pin window** (the last N deployments to the origin or the last D days).
  It bounds exposure without operator action, but a working build stops being
  served on a timer, with no deploy or revoke to point at. A count-only window
  ties expiry to a deploy; deferred until revocation proves too coarse.
- **An operation policy for the window** (ADR 066). It fits a count, but a
  policy only allows or denies, an absent instance means no limit, and the
  policy deciding must come from the target's current release, never the
  pinned one, or an old release could approve itself.
- **A pinnable flag on the release.** Only a release marked pinnable can be
  pinned; any other answers as if never deployed to the origin. Off by
  default, the exposure is the releases someone chose rather than every
  release ever deployed. Unlike revoking, clearing the flag is reversible and
  leaves the release deployable and rollback-able. Open: who sets it (`deploy
  --pinnable`, or the CLI by default once a project's builds pin), and it is
  mutable state on an otherwise immutable release, as `revoked_at` is. The
  strongest candidate if revocation proves too coarse.
- **A content digest in the header.** Reproducible across projects, it would
  let one bundle be promoted between projects and a pipeline assert that two
  projects received the same content. It needs a canonical form per resource
  kind, and revision content holds per-project values (flow audience app and
  team IDs, the server-assigned schema `$id`). It can be added as a second
  form of the header later (§2).
- **A branch or channel in the header.** A pin names one immutable release; a
  branch is a moving pointer, which is what resolution by origin already is.
  Mixing both would give the header two meanings that the refusals and
  revocation do not fit.
