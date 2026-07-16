---
"@zitadel/components": patch
---

Enforce `required` fields client-side so an empty required control blocks
submission and shows a styled, localised error — instead of being sent and
rejected by the server.

A submit-type `<zl-button>` used to both call `form.requestSubmit()` and emit a
parallel `zl-submit` event; the orchestrator acted on the event without
checking anything, so a button click bypassed validation while the
Enter-to-submit path did not. Submit-type buttons now delegate to the form
only — the form's `submit` event is the sole submission signal for the primary
action — while non-submit buttons keep emitting `zl-submit` for navigation
(back, skip, passkey, register/sign-in switch), which stays ungated.

On that submit path the orchestrator checks the step's `required` fields (via
each atom's live `formValue`, so autofill that skipped `input` events is still
seen) and, when one is empty, surfaces the error through the server's own
`error.<field>_required` dialect. It reuses the existing localisation and
inline/banner routing, so the client-side required message is styled and
localised exactly like a backend rejection — no native browser validation
bubble.

Field errors now render inline under every control type, not just email and
password. `<zl-select>` and `<zl-checkbox>` gained an `error`/`invalid`
contract mirroring `<zl-field>` (with React `Select`/`Checkbox` parity), and the
error router tags each localised error with the field it targets: a
`error.<field>_<rule>` error whose field the step renders now shows inline on
that control instead of in the form-level banner. Errors with no field (engine
errors) or whose field the step omits still fall back to the banner. Selected
dropdown values and checkbox states also survive an error re-render, so a
validation failure no longer resets them.
