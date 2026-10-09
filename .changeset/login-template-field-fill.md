---
"@zitadel/components": minor
"@zitadel/config": minor
---

feat: login templates bind fields by name only. `<zitadel-login>` fills each
`<zl-field>`, `<zl-select>` and `<zl-checkbox>` from the step after every
render — label, type, value, autocomplete, required, placeholder, help, inline
error, test hook, select options and the forgot-password link — so the field
loop in the bundled template and the `centered` and `minimal` starter designs
shrinks from 44 lines to 7:

```liquid
{% for f in fields %}
  {% case f.type %}
  {% when 'checkbox' %}<zl-checkbox name="{{ f.name }}"></zl-checkbox>
  {% when 'select' %}<zl-select name="{{ f.name }}"></zl-select>
  {% else %}<zl-field name="{{ f.name }}"></zl-field>
  {% endcase %}
{% endfor %}
```

An attribute a template writes itself always wins, so custom wording keeps
working and templates ejected before this change render exactly as before.
To leave a filled part out, write it empty (`placeholder=""`,
`forgot-password-href=""`). The scaffolded branding `README.md` gains a
"Fields" section listing every attribute that is filled in and where it
comes from.
