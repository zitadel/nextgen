---
"@zitadel/server": minor
"@zitadel/cli": minor
"@zitadel/testing": minor
---

`POST /flow` with no `Origin`, and one opened from a console origin (`server.public_base` or `server.console_origins`) the project does not list, is served the deployment to the `default` target. A deployment names that target with `default`, alone or together with `primary`. Nothing deployed there answers `409` with `rel.no_default`. `zitadel origin rm` warns that a project with no origins admits no origin except a loopback origin. The test kit deploys the bootstrapped release to the app origin and to `default`, and platform bootstrap deploys the platform project to its primary origin and to `default`.

**Breaking:** a project with no origins no longer serves a flow to an arbitrary host, and a flow with no `Origin` requires a default deployment. A listed origin, a loopback origin, or a live preview with nothing deployed answers `rel.not_deployed`.
