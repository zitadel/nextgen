---
"@zitadel/server": minor
"@zitadel/cli": minor
"@zitadel/testing": minor
"@zitadel/components": patch
---

A sign-in runs only what is deployed. `zitadel origin rm` warns that a project with no origins admits no origin except a loopback origin, and the test kit deploys the bootstrapped release to its primary origins, which default to a loopback origin. `zitadel setup --dev-port` deploys the release the old port ran to the new one, and `zitadel doctor --fix` does the same for the issuer it makes primary, or says to deploy. `<zitadel-login>` says to deploy when it cannot start a flow because nothing is deployed.

**Breaking:** a project with no origins no longer serves a flow to an arbitrary host. A flow with no `Origin`, or from a console origin the project does not list, needs a primary deployment and otherwise answers `rel.no_default`. A listed origin or a live preview with nothing deployed answers `rel.not_deployed`, and so does a primary origin added since the last deploy. A loopback origin the project does not list is no longer served the newest primary deployment: it answers `rel.not_deployed` until it is added as a primary origin and deployed to. The test kit registers `appOrigins` as primary origins, so each must be an exact URL; a wildcard pattern is refused.
