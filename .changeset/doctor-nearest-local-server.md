---
"@zitadel/cli": patch
---

`doctor` run in an app inside the directory `zitadel start` ran in now checks that local server — the one setup attached the app to — instead of the default port 8080. It read local runtime state from the current directory only, so it reported "No existing runtime metadata", counted the app's own server as another runtime, and failed with `E_PORT_IN_USE` whenever anything else held port 8080. It now finds the nearest started server on the way up, like setup and `console`, and `--port` defaults to that server's port. When that server is unhealthy, or its record is malformed, the suggested `start` and `reset --force` now carry `--cwd` for the directory that holds it, instead of acting on the app directory.
