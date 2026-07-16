---
"@zitadel/components": patch
---

Stop the `{% mandatory_gates %}` safety net from duplicating required
`<zl-select>` and `<zl-checkbox>` fields.

The runtime safety net appends any required field that has no matching atom in
the rendered form. Its presence check only looked for `<zl-field>`, but a
`select` renders as `<zl-select>` and a `checkbox` as `<zl-checkbox>` — so a
required select or checkbox was treated as missing and a duplicate generic text
field (labelled with its raw `text_key`) was appended at the bottom of the
form. The check now matches across all form-participating atoms
(`<zl-field>`, `<zl-select>`, `<zl-checkbox>`).
