---
"@zitadel/cli": minor
---

Add `zitadel run`, the local development loop. It starts (or adopts) the local Zitadel server and your app's own `dev` script in one foreground session and interleaves both log streams on stdout, prefixed by `server`, `app`, and `zitadel`. While it runs, `r` applies the repo config exactly as `zitadel apply` does, `R` applies around a full restart of the server and the app, and `q` (or Ctrl-C) ends the session, stopping only what the session itself started, so a server that was already running keeps running. It applies once at startup unless `--no-apply`. The app command is the project's `dev` script through its package manager, overridable with `--app-command` or skippable with `--no-app`; a project without a `dev` script reports why and the session continues. `--port`, `--runtime`, and `--image` select the runtime the way `start` does, `--dry-run` reports the plan as a normal envelope, and `--json` is refused because the session streams.
