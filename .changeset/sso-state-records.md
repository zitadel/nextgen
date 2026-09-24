---
"@zitadel/server": patch
---

Store single-use SSO state records on the auth attempt: the `sso_callback` check row keyed by the hash of the `state` value, consumed exactly once at the provider callback. Groundwork for social login; no user-facing change yet.
