# Release pinning

> **Status:** Implemented
> **Date:** 2026-11-24
> **Context:** [#1635](https://github.com/zitadel/nextgen/issues/1635): a
> build of the customer's app keeps the sign-in configuration it was built
> against. Tickets #1636 (contract), #1310 (server), #1580 (SDKs and CLI),
> #1581 (events).

## The rule

`X-Zitadel-Release` on `createFlow` (and `setUserPassword`) names a release.
After the request's `Origin` has picked a target, as it does without a pin,
the server serves the newest deployment of that release to that origin. A
release stays pinnable until it is revoked.

- A pin never deploys a release and never admits an origin: `Gate` runs first.
- The lookup reads the deployment history, not the live view
  (`deployment.ListOptions(project, &origin, &release, 1)`), so a release the
  origin no longer serves is still found.
- The newest deployment of the release wins, so a variables-only redeploy of
  it reaches pinned clients.
- The flow cookie and the authentication attempt seal the deployment, as they
  do for an unpinned start. Later steps send no header.

| Case | Answer |
| --- | --- |
| deployed to the origin, not revoked | served, `Source: "pin"` |
| never deployed to the origin | `409 rel.not_deployed`, details `{origin, release}` |
| no `Origin`, or the console's unlisted origin | `409 rel.not_deployed`, details `{release}` |
| revoked | `409 rel.revoked` |
| not a release of the project | `404 rel.not_found` |
| not a release ID | `400 rel.reference_invalid` |

## Decisions

- **The header names a release by its ID.** `domain.ParseReleaseReference` is
  the one place a value is read; a second form, such as a content digest that
  survives promoting one bundle between projects, is added there. The spec
  gives the header no pattern, so generated clients forward it unread and the
  server's own code answers a malformed one.
- **Only operations that resolve a deployment declare it.** ogen builds the
  CORS preflight's allowed headers from each operation's declared headers.
  The SDKs send it on `createFlow` alone.
- **No pin window.** A count or age bound would make a working build stop
  being served with no deploy or revoke to point at. Revocation is the only
  control.
- **A pin without a target is refused, not ignored.** Serving the project
  default would silently switch configuration, which is what pinning exists to
  prevent.

## The security trade-off

The header is not a credential. Every release ever deployed to an origin can
be selected from that origin until it is revoked, including one replaced
because it was less secure: a weaker password policy, a flow without a second
factor, a removed identity provider. The customer docs
([releases and deployments](../../../apps/docs/content/docs/concepts/releases-and-deployments.mdx#revoked-releases))
tell operators to revoke superseded releases after a deploy that tightens
security, and spell out what that costs:

- revoking is per release;
- a revoked release cannot be deployed or rolled back to;
- `rel.in_use` refuses a release an origin still serves, so the replacement
  deploys first;
- a deploy racing a revoke is not serialised (TODO #2206 in
  `service/release.go`).

Follow-ups if revocation proves too coarse: a bound on how far back a pin
reaches, or a bulk "revoke every superseded release on this origin" command.

## Events

Every event emitted while a deployment serves a request carries
`deployment_id`, `release_id` and `target` (`audit.BindRuntime`). The mark
sits beside the actor slot, as the authorization mark does, so `request.api`
reads it too. `GET /events` filters by `release_id` and `deployment_id`, which
is how an A/B test of the sign-in can be read from Zitadel's side.

The session exchange's events are not stamped: the exchange runs in
`storage/session`, which does not reach the audit context.
