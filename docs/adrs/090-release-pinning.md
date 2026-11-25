# ADR 090: Release Pinning

> **Status:** Proposed
> **Date:** 2026-11-25
> **Context:** [#1635](https://github.com/zitadel/nextgen/issues/1635)
> **Related:** [ADR 035](035-configuration-environments.md),
> [ADR 081](081-customer-hosted-login-and-oidc-provider.md)

## Context

An app's code and its sign-in configuration are deployed separately. Zitadel
serves each sign-in the newest release deployed to the app's origin. So the
two can fall out of step: when the app is rolled back on its host, or when a
browser tab still runs an older build of the app.

## Decision

A build of the app can pin the release it was built against.

- The build sends the release ID in the `X-Zitadel-Release` header when it
  starts a sign-in.
- The server first finds the target from the request's `Origin`, as it does
  today. It then serves the pinned release, if that release was deployed to
  this origin.
- A release that was never deployed to the origin, or that was revoked, is
  refused with an error the app can show.
- A pinned request without an `Origin` is refused too. Without a pin, such a
  request gets the project's newest deployment; with one, that would silently
  serve a different release than the one asked for.
- The rest of the sign-in stays on the same release, as it does today.
- Pinning is optional. Without the header, nothing changes.

## Security concerns

The header is not a secret. Anyone can send it with any release ID.

- It can only select a release that was deployed to the same origin. It
  cannot reach other origins, other projects, or revoked releases.
- But every release ever deployed to the origin stays selectable until it is
  revoked. That includes older releases with weaker settings, such as a
  shorter password, no second factor, or an identity provider that was
  removed.
- So after a deploy that tightens security, the older releases must be
  revoked. Revoking works one release at a time, and a revoked release can no
  longer be deployed or rolled back to.

## Future possibilities

- **A/B testing.** Today a release must go live on the origin before it can be
  pinned there, so a variant cannot be tested without first serving it to
  everyone. A staged deployment, which makes a release available on an origin
  without serving it, would allow two releases side by side, with the app
  choosing one per visitor.
- **A pinnable flag.** Only releases marked as pinnable could be pinned. This
  limits what a forged header can reach, and can be undone, unlike revoking.
- **A limit on how far back a pin reaches**, such as the last few deployments
  to the origin.
- **Pinning by content.** A digest of the release's content, instead of its
  ID, would let the same build work across projects.
