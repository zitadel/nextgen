---
"@zitadel/server": patch
---

The server has a UI mode, `server.ui` (`NEXTGEN_SERVER_UI`): `embedded`, the
default and the behaviour so far (the console and the login UI from the
binary, each still switched by `console_enabled` and `login_enabled`, and the
runtime document with them); `external`, no embedded UI but
`GET /console/runtime.json` stays, for a deployment whose UIs are built and
served next to it on the same host; and `headless`, neither, for an API-only
deployment. A build with the `noui` tag embeds no UI at all, for deployments
that never serve one from the binary.
