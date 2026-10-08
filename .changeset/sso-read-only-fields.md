---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/components": minor
---

A step field can now carry `read_only`. On a step with `on_success: create_user_with_sso`, the engine sets it on a field prefilled from a unique claim the provider verified, because the submit refuses a changed value. `<zl-field>` gains a `readonly` attribute that renders the value read-only and still submits it, and the shipped login templates pass it through. A template that ignores `read_only` keeps an editable field, and the submit still refuses the change.
