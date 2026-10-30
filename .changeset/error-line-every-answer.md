---
"@zitadel/server": minor
---

Every answer of 400 or above now logs one `api error` line with the error that caused it, a rejected sign-in step such as a password the policy does not accept included, so `zitadel logs --level info` shows why a request or a step was rejected. The lines for a 4xx answer say where the error was raised.
