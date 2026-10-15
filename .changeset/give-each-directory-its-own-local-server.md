---
"@zitadel/cli": patch
"@zitadel/server": patch
---

Give each directory its own local server and port, for the binary and the Docker runtime alike. `zitadel start` now keeps the port a directory already had, and otherwise takes the first free port from 8080, so two projects no longer compete for 8080. It checks that a port is free by trying to use it, not by parsing `lsof`, and it refuses an explicit `--port` that is taken instead of reporting another folder's server as its own. `zitadel console`, `zitadel setup` and the other commands only use the server named in the directory's own `.zitadel/local/runtime.json`, and no longer fall back to whatever answers on port 8080; when a directory has none, the error says to run `zitadel start` or to name a server with `--server`. `zitadel start` runs the server binary directly instead of through a wrapper, and `zitadel stop` now also stops a server whose recorded process has already died, and says plainly when a directory has no server to stop. `@zitadel/server` now exports `@zitadel/server/binary`, which finds the server binary for a platform, so the CLI and the wrapper share one list of platforms.
