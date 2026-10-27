---
"@zitadel/cli": patch
---

`zitadel doctor` no longer checks a local Zitadel runtime for a project set up against a hosted server, so another app on port 8080 no longer fails it with `E_PORT_IN_USE`, and its `source` is the project's server. It still checks the local runtime before `setup`, for a project on a local server, where `zitadel start` ran in the directory or a parent, and when you pass `--port`, `--runtime` or `--image`.
