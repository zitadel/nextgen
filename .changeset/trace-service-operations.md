---
"@zitadel/server": patch
---

Traced requests now show each service operation (for example `UserService.CreateUser`) as its own span, with the database statements it ran nested below it.

The event retention purge and the event export shipper now start a trace for each run, sampled at the same ratio as requests, so their service operations and statements are traced too.
