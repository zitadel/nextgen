---
"@zitadel/components": minor
"@zitadel/server": minor
---

feat: the sign-in and sign-up surface is rebuilt on the shadcn design language. The card, fields, buttons, alert and trustmark are re-cut to the shadcn geometry and re-keyed onto the shadcn token roles, so every colour now comes from a semantic `--zl-*` role and light mode falls out of the token layer. Form-level alerts move below the fields, forgot-password moves onto the password field's label row, and headings and labels are set in the display face. Tenant branding, the `part`/`exportparts` hooks and `suppress-header` are unchanged.
