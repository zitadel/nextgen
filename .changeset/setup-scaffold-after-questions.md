---
"@zitadel/cli": patch
---

`zitadel setup` no longer leaves a half-set-up app behind in a directory it
creates a new app in. It creates the app only once it has every answer, so
cancelling a question leaves the directory as it was. When a later step fails,
such as an unreachable server, a failed upload of the default schema, or Ctrl-C,
setup removes the app again and puts back what the directory held. The next run
then sets up a new app, with the `/` → `/login` redirect, instead of treating
the leftover skeleton as an app that existed before. In an empty directory,
`--dry-run` no longer runs the framework's generator (such as
`create-next-app`): it previews the project and writes nothing.
