---
"@zitadel/server": minor
---

Add the `sessions.gc` background reaper: expire sessions past `expires_at`, emit Path B `session.expired` with a system actor, then hard-delete them on the self-hosted jobs Engine poll.
