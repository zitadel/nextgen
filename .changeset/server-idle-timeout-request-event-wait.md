---
"@zitadel/server": patch
---

`server.idle_timeout` sets how long the server keeps an idle connection open (`0` never closes one), so a reverse proxy's `POST` no longer ends as a 502 on a connection the server just closed. A request audit event that a retry finds already stored is no longer logged as dropped, and `events.request.flush_wait` writes it before the response ends.
