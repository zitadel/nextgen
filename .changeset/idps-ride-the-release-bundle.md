---
"@zitadel/cli": patch
---

Identity provider connections now ride the release bundle instead of being written on the side. A deploy used to call `POST /idps` once per `.zitadel/idps/*.json` before building the release, because the bundle could not carry them; it can now, and the server creates or revises each connection inside the release's own transaction. So a build that fails leaves no connection behind, and a connection's fixed fields are checked by the same build a dry run previews. The local checks are unchanged: a `client_secret` holding a value rather than a `${{ NAME }}` reference, an `oidc` block naming some endpoints but not the rest, and a credential variable the project does not hold are all still named against the file they came from, before anything leaves the machine.
