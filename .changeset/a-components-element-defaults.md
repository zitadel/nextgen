---
"@zitadel/components": patch
---

Unset props now mean "use the default" on every element. Assigning `undefined`, `null` or `""`,
or removing the attribute, restores `purpose` ("login"), `variant` ("widget"), `theme`, `lang`,
`suppress-header`, and the session card's `heading` and `logout-label`. A cleared `purpose` no
longer starts a flow the server rejects, and a cleared heading no longer leaves an empty title.
Re-binding an empty config prop as `undefined` no longer restarts an untouched sign-in flow.
