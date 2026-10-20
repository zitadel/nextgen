---
"@zitadel/server": patch
"@zitadel/config": patch
---

A login flow submission now must name an action the current step declares. Any other name, including an empty one and the outcome names `user_not_found`, `user_already_exists`, `sso_user_not_found` and `sso_authenticated`, is refused with 400 `flow.invalid_action` before the identifier is checked. Before, a client could send an outcome name as the action and take the route the step keeps for that outcome, for example reaching the end of the flow without proving a sign-in factor. Flow definitions, and the `@zitadel/config` validator, now reject a step action named after one of these outcomes; rename such an action before you apply the definition.
