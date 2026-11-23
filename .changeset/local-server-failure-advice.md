---
"@zitadel/cli": patch
---

A failure of the local server now carries the same hint and next commands from every command, not only the server commands. A malformed runtime record or admin file found in a parent folder points its recovery commands at that folder, a server that no longer answers points `zitadel start` at the folder that recorded it, and the recovery for a malformed admin file removes the file before it resets.
