---
"@zitadel/server": minor
---

The server now stores variables per kind, so `kind=preview` on the variable operations is served instead of answering `501`. A secret written without `kind` removes the name's `preview` value as the contract describes. A write after which one kind's variables would no longer fit in a single deployment is refused with `400 var.limit_exceeded`. Every value written or removed is recorded as a `variable.set` or `variable.deleted` audit event carrying the kind, never the value.
