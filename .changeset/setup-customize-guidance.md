---
"@zitadel/cli": patch
"@zitadel/config": patch
---

Surface the customize loop after setup: the "Zitadel is ready" next steps now
point at the editable `.zitadel/schemas/` and `.zitadel/flows/` files and the
`plan`/`apply` commands, and the scaffolded READMEs are restructured
workflow-first (mental model → example → making changes → common changes).
