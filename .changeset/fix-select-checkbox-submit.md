---
"@zitadel/components": patch
---

Fix `<zl-select>` and `<zl-checkbox>` values being submitted as empty
strings, and let optional selects clear back to no value.

- The orchestrator now reads and restores every input atom through a
  uniform `formValue` getter/setter contract instead of only querying
  `<zl-field>` and listening for `zl-input`. `<zl-select>` and
  `<zl-checkbox>` (which emit `zl-change`) are captured on submit, and
  any future field atom that exposes `formValue` works without
  orchestrator changes. `<zl-field>.formValue` reads the live `<input>`,
  so browser/password-manager autofill is captured even when no `input`
  event fired.
- `<zl-select>` always renders a leading empty option (labelled with its
  `placeholder`). Optional fields can clear back to an empty submission;
  required fields get an explicit prompt row that `required` blocks until
  a real choice is made, mirroring native `<select>` semantics.
- The API default Liquid template renders `select`/`checkbox` field types
  as `<zl-select>` / `<zl-checkbox>`, and `maritalStatus` /
  `newsletterOptIn` label and placeholder keys were added to the en, de,
  and it locales.
