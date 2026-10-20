---
"@zitadel/components": minor
---

`<zitadel-login>` shows a message in English, German and Italian when a sign-in provider returns an account that has no user and the connection does not allow creating one.

When the server answers `flow.restart_required` (for example, the provider's connection was deleted while the user was signing in), `<zitadel-login>` starts a fresh flow and tells the user to start again, instead of showing only an error. It restarts at most once in a row, so a server that keeps refusing cannot loop it.
