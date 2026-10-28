---
"@zitadel/server": minor
---

A server that runs only while it serves a request, such as a Vercel function, can now leave the purge of expired audit events to a scheduler outside it. Set `events.retention.trigger_secret` to at least 16 characters: the server then stops its hourly purge and runs one each time `/cron/events-retention` is called with the secret as a bearer token. Without the setting, the server purges hourly as before.
