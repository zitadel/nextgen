---
"@zitadel/server": patch
"@zitadel/api": patch
---

The console's error screens now show the failed request's ID instead of the error code, so a support request can quote it, and `ApiError` from `@zitadel/api` carries it as `requestId`. A not-found screen names what is missing, such as "User not found", and leads back to its list; the others lead to Projects without the selected project.
