---
"@zitadel/cli": patch
---

`zitadel setup` creates a new app only once it has every answer. In an empty
directory, `--dry-run` no longer runs the framework's generator (such as
`create-next-app`): it previews the project and writes nothing. Cancelling a
question after picking the framework now leaves the directory as it was, so the
next run still sets the app up as a new one, with the `/` → `/login` redirect,
instead of treating the skeleton left behind as an app that existed before.
