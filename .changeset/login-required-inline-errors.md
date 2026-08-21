---
"@zitadel/components": patch
---

Login flow: enforce required fields client-side and show inline errors on every control.

- Submit-type `<zl-button>` now delegates to the form, so the primary action
  can't bypass validation; non-submit buttons keep emitting `zl-submit` for
  ungated navigation (back, skip, passkey, sign-in/register switch).
- On submit the orchestrator checks the step's `required` fields via each atom's
  live `formValue` (so autofill that skipped `input` events is still seen) and
  surfaces an empty one through the server's own `error.<field>_required`
  dialect — styled and localised exactly like a backend rejection, with no
  native validation bubble. Checkboxes are excluded: a rendered checkbox always
  submits a real boolean (`false` when unticked), so a must-accept boolean is a
  schema concern (`const: true`), keeping browser and API clients aligned.
- Field errors render inline under every control type, not just email/password:
  `<zl-select>` and `<zl-checkbox>` gained an `error` / `invalid` contract (with
  React `Select` / `Checkbox` parity, including a generated fallback id so the
  error stays wired to the control via `aria-describedby`). Selected values and
  checkbox states survive an error re-render.
