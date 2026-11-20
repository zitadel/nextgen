---
"@zitadel/server": patch
---

Timestamps the API returns are now always UTC. pgx scanned Postgres `timestamptz` into the process's local time zone, and a read path that did not convert the value itself passed that zone on: running with `TZ=Europe/Berlin`, `getProjectClaimStatus` returned `claimed_at` and the claim window's `expires_at` with a `+01:00` offset instead of `Z`. The pool now scans `timestamptz` in UTC, so every read returns UTC whatever zone the server runs in. `initProjectClaim` built its `expires_at` from the clock rather than a read, and now stamps it in UTC too.
