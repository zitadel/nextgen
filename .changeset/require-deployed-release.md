---
"@zitadel/server": minor
"@zitadel/cli": minor
"@zitadel/testing": minor
---

A sign-in runs only what is deployed. `zitadel origin rm` warns that a project with no origins admits no origin except a loopback origin, and the test kit deploys the bootstrapped release to the app origin and to `default`.

**Breaking:** a project with no origins no longer serves a flow to an arbitrary host. A flow with no `Origin`, or from a console origin the project does not list, needs a default deployment and otherwise answers `rel.no_default`. A listed origin, a loopback origin, or a live preview with nothing deployed answers `rel.not_deployed`.
