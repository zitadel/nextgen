---
"@zitadel/config": patch
---

The flows README that `zitadel setup` writes into `.zitadel/flows/` no longer suggests selecting a flow in the login widget by its `audience`. `<zitadel-login>` sends no app or team hint, so it runs the flow named by `flowName`, or else the newest active flow without an `audience`; an `audience` only keeps a flow out of that default, and a scoped flow is still served when no unscoped flow serves the purpose. If you scoped a flow so the widget would pick it, give it a `name` and pass that as `flowName` instead.
