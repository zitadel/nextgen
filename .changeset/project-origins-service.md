---
"@zitadel/server": minor
---

Project origins are stored and validated on create and add: nested add/remove endpoints no longer return 501, shared-host wildcards without a tenant label are rejected, and `origins.shared_hosts` replaces the default host→allow-regexp map when set.
