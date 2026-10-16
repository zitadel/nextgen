---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

JWT verification now caches each issuer's whole JWKS document instead of one key per `kid`. A token naming a `kid` the cached keys lack refreshes them — how a rotated key is picked up — at most once every 30 seconds, and concurrent misses share one fetch; previously any token with a made-up `kid` cost a JWKS request, an unauthenticated way to load the backend on every request. An EC key that names no `alg` now verifies (its curve decides the algorithm), and a token whose `alg` cannot fit the key is rejected quietly instead of logging an error. `clearJwksCache()` drops the cached keys, for example after a key compromise. An expired key set is never used when its refresh fails, a failed fetch counts toward the 30 second throttle so a failing endpoint is not retried on every request, and `clearJwksCache()` also discards fetches that were already in flight.
