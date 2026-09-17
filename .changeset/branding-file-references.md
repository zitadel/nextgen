---
"@zitadel/cli": minor
"@zitadel/config": minor
"@zitadel/server": minor
---

A branding descriptor now points at its login template with `"liquid_template": { "$file": "./login.liquid" }` instead of a separate `liquid_template_file` key. The CLI replaces any `$file` reference with the file's content before publishing and writes the published value back into the file afterwards. `branding eject` and `setup --design` scaffold the new form, and a descriptor that still carries `liquid_template_file` fails `zitadel plan` with a hint showing the replacement.
