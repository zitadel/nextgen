---
"@zitadel/server": minor
---

Add the `sessions.gc` background reaper: delete expired sessions with a filter (`DeleteSessions`), emit Path B `session.expired` with a system actor for each deleted row, and log the deleted count per run on the self-hosted jobs Engine poll.
