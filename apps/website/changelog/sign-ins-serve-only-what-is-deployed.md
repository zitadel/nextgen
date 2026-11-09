---
title: A sign-in runs only what is deployed
summary: Publishing a flow, schema, identity provider, branding or policy no longer changes sign-in until a release that pins it is deployed, and an origin with nothing deployed is refused instead of served the newest revisions.
date: 2026-11-06T00:09Z
cloud: true
pulls: [2552, 2553, 2554]
---

A sign-in now runs only what a deployed release pins. Publishing a new revision of a flow, user schema, identity provider, branding or policy changes nothing a user sees until you deploy a release that pins it, so `zitadel deploy` is the one way an edit to `.zitadel/` reaches your users.

- A request is served only what its release pins: a flow, schema, identity provider, branding or policy the release leaves out is not served, and a request with no release answers `rel.not_deployed`.
- A request with no `Origin`, or from a console origin the project does not list, is served the project's newest primary deployment, and answers `409` `rel.no_default` when there is none. That deployment stays live whatever the project lists, so its release cannot be revoked.
- A listed origin, a live preview or a loopback origin such as `http://localhost:3000` with nothing deployed to it answers `rel.not_deployed`, and so does a primary origin added since the last deploy. A project with no origins admits only loopback origins.
- `setUserPassword` applies the password policy of the release that serves the caller's `Origin`, so a frontend on a preview URL gets that preview's policy. `createAuthAttempt` follows the newest primary deployment.
- A release that pins no flow answers `flowdef.not_found` saying so, and `zitadel deploy` warns that such a release strands every existing user.
- The console's project page shows the password policy the primary origins' release pins, not the newest published one.

The CLI helps you keep origins deployed: `zitadel setup --dev-port` deploys the release the old port ran to the new one, `zitadel doctor --fix` does the same for the issuer it makes primary, or says to deploy, and `zitadel origin rm` warns before it leaves a project with no origins. `<zitadel-login>` says to deploy when it cannot start a flow because nothing is deployed.

**Breaking:** a flow, schema, identity provider, branding or policy you publish no longer applies until a release that pins it is deployed, and an origin with nothing deployed is refused rather than served the newest revisions. Run `zitadel deploy` after you add an origin, and deploy to a loopback origin you sign in from: add it as a primary origin first. In tests, what you publish after `startZitadel` applies once a release that pins it is deployed, and `appOrigins` must be exact URLs, since the test kit registers them as primary origins.

[Releases and deployments](https://preview.zitadel.com/docs/concepts/releases-and-deployments)
