---
"@zitadel/components": patch
---

The login form now shows a "Waiting for your passkey…" status with a Cancel
button while a WebAuthn ceremony is in flight; cancelling aborts the ceremony
and returns to the step with the fallback actions usable. Ceremony timeouts get
their own copy (`error.passkey_timeout`) instead of reading as cancellations,
and the cancelled copy no longer says "setup" for login ceremonies.
`<zl-passkey>` emits a new `zl-passkey-started` event and accepts
`pending-label`, `cancel-label`, and `silent` attributes. Step error banners
are dismissible and clear as soon as the user edits a field (the edited
field's inline error clears too); errors reappear only if the server
re-reports them.
