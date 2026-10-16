---
"@zitadel/sdk-core": patch
---

A JWKS refresh that fails with a network error or a timeout now keeps verifying tokens against
the keys already cached, as a 5xx already did, instead of rejecting every bearer and JWT session
until the endpoint answers again. Every failed refresh, a 5xx included, is logged once with the
JWKS URL and the cause, and the endpoint is not fetched again for five seconds.
