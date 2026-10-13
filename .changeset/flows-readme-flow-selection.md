---
"@zitadel/config": patch
---

The flows README that `zitadel setup` writes into `.zitadel/flows/` no longer suggests selecting a flow in the login widget by its `audience`. `<zitadel-login>` sends no app or team hint, so it runs the flow named by `flowName`, or else the newest active revision without an `audience` that serves the requested purpose; an `audience` only keeps a flow out of that default, and a scoped flow is still served when no unscoped flow serves the purpose. If you scoped a flow so the widget would pick it, pass its `name` as `flowName` instead. The README also says that older revisions stay active, so an `audience` added after a flow was applied without one doesn't take that earlier revision out of the default.
