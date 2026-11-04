---
"@zitadel/components": patch
---

`<zitadel-login>` checks a field's minimum and maximum length before submitting. `<zl-field>` shows only the error under a field while it has one, and its help text again once the error clears. A wrong password (`error.invalid_credentials`) now shows on the password field instead of in the form-level alert, so a custom template must render that field's error (`f.name | fieldError: errors`) to show it.
