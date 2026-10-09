---
"@zitadel/docs": patch
---

Read the public site URL from `DOCS_SITE_URL` at build time so the same docs build can be served from another origin, such as the preview cloud host that mounts it under `/docs`. Defaults to the previous `https://zitadel.com/docs/preview`.
