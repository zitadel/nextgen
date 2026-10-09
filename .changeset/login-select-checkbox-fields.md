---
"@zitadel/components": patch
---

Login flow: render and submit `select` and `checkbox` user-schema fields.

- The default template renders `select` / `checkbox` field types as
  `<zl-select>` / `<zl-checkbox>`.
- `<zl-select>` / `<Select>` are agent-first: a real native `<select>` is the
  operable, accessible, automatable control, with the Figma-styled trigger kept
  as a pointer-only visual layer. Screen readers, keyboard users, password
  managers and automation drivers can now pick an option (e.g. enum schema
  fields during CLI-driven registration).
- The orchestrator captures every input atom through a uniform `formValue`
  contract, so `<zl-select>` and `<zl-checkbox>` submit the right shape: a
  checkbox as a real JSON boolean, a select as its chosen enum member, with
  empty enum values omitted so an untouched optional select isn't rejected by
  the server's enum check.
- The leading placeholder row drops any empty-valued member the schema enum
  itself lists, so no duplicate empty option is rendered.
- The styled popup closes on `Escape` for pointer users (keyboard users already
  get this from the native `<select>`).
- The `{% mandatory_gates %}` safety net recognises `<zl-select>` /
  `<zl-checkbox>`, so a required select or checkbox no longer gets a duplicate
  generic text field appended.
