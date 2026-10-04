---
"@zitadel/components": patch
"@zitadel/server": patch
---

Tighten the login atoms. `<zl-field>` restores its initial `value` on form reset, as `<zl-select>` and `<zl-checkbox>` do, and takes an `aria-label` for inputs with no visible label. `<zl-alert>` lists its `detail` and `link` parts and slots in its manifest, so `<zitadel-login>` forwards them as `alert-detail` and `alert-link`. The package root exports `ZlPasskey`, `zlPasskeyManifest`, the passkey event detail types, `ZlFieldInputDetail`, `ZlSubmitDetail` and `SHIPPED_ICON_NAMES`, and `addEventListener` is typed for every `zl-*` event. The passkey pending status and its cancel button are spaced apart, a linked `<zl-pill>` keeps a solid fill on hover, the `<zitadel-logout>` menu takes its shadow and sizes from the design tokens, and the hosted login page's "Try again" button has its fill.
