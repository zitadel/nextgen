---
"@zitadel/server": patch
---

The console now tells an unreachable server apart from a deployment that has no
project yet. Its boot-time configuration read (`GET /console/runtime.json`) used
to resolve every failure — a dropped connection, a `500`, an unreadable body —
to the same "No project yet" screen, so an outage read as missing setup and sent
operators to run `zitadel setup` against a problem setup cannot fix. Those cases
now render a "Server unavailable" screen naming what went wrong, with a retry
button that re-reads the configuration in place once the server is back. A
server that answers normally but has no project still shows the setup hint,
unchanged.
