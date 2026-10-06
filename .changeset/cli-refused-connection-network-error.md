---
"@zitadel/api": patch
"@zitadel/cli": patch
---

A platform request that gets no response is now reported reliably and can be cancelled.

- `@zitadel/api`: the client throws a typed `NetworkError` (reason `unreachable` or `timeout`) when
  a request gets no response, alongside `ApiError` for a failing status. `createZitadelClient`
  takes an optional `signal` and `timeoutMs`; an aborted request rejects with the signal's reason.
- `@zitadel/cli`: a refused, unresolvable or silent server reports `E_NETWORK` (exit 4) on every
  command, the same as a server answering 5xx; before, a failure worded differently by the fetch
  runtime fell through to `E_VALIDATION` (exit 3). Each request has a 30-second deadline, and
  Ctrl-C while one is waiting cancels it with the new `E_CANCELLED` (exit 130) instead of leaving
  the command hung behind a spinner.
