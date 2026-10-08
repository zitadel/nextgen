---
"@zitadel/docs": patch
---

Read the public site URL from `DOCS_SITE_URL` at build time so the same docs build can be served from another origin, such as the preview cloud host that mounts it under `/docs`. Defaults to the previous `https://zitadel.com/docs/preview`.

The docs pages moved from `content/docs` to the content root: the overview is now `/` (was `/docs`), `/concepts/…`, `/cli/…`, `/get-started/…` and `/sdks/…` lose their `/docs` prefix, the API reference stays at `/reference/api/…`. With `DOCS_BASE_PATH=/docs` the whole site mounts under one prefix, which is how the preview cloud serves it.

