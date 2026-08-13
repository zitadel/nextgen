---
"@zitadel/server": patch
---

Local HTTP runtimes (`http://localhost`) now omit the `Secure` flag on `_zflow` and `__nextgen_session` cookies so Safari can complete register/login; HTTPS responses still set `Secure`.
