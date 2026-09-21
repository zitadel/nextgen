---
"@zitadel/server": patch
---

Internal plumbing for ADR 058 §3/§4: the `user-ref` resolution primitives
(designation readers, `domain.ResolveUserRef`, and the batched
`(project_id, user_ids) → refs` resolution port) and the inert `user-ref`
wire component. No endpoint behavior changes yet — session adoption ships
separately.
