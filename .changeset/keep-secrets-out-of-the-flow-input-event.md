---
"@zitadel/components": patch
---

`<zitadel-login>` no longer dispatches `zitadel-flow-input` for a password or one-time-code field, so wiring `onFlowInput` to logging or analytics cannot capture what a visitor types there. Other fields dispatch as before. The atoms' internal `zl-input`, `zl-change` and `zl-passkey-result` events are no longer composed, so they stay inside the widget.
