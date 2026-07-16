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
