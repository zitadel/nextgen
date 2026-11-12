---
"@zitadel/server": minor
"@zitadel/api": minor
---

Setting or checking a password can now be refused with `429 Too Many Requests`, the error code `user.password_hashing_busy` and a `Retry-After` header; nothing was changed, so the request is safe to retry. `@zitadel/api` types the code on `setUserPassword`, `verifyChallengeProof`, `getFlowStep`, `submitFlowStep` and `finishUserPasskeyRegistration`. The server does not send it yet.
