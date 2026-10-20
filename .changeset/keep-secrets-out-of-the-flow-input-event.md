---
"@zitadel/components": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
---

Breaking, security-relevant change to a public event contract: the `zitadel-flow-input` event, which `<zitadel-login>` dispatches on every edit and which is composed so any script on the page can read it, no longer carries the value of most fields. Its detail used to be `{ name, value }` for every field, so an analytics script listening on `document` could read a visitor's password as it was typed. The detail is now a union you narrow on `secret`: `{ name, secret: false, value }` for an identifier field and `{ name, secret: true }`, with no `value`, for every other field. A field is an identifier when its step definition has the type `text`, `email` or `tel` and an `autocomplete` of `username`, `email`, `tel`, `name`, `given-name`, `additional-name`, `family-name` or `nickname`; the type alone never qualifies, and a sensitive token beside it (`current-password`, `new-password`, `one-time-code`, `bday*`, `cc-*`, `transaction-*`) makes it secret. The rule is an allow-list, so a PIN, a security answer or any field it does not name is secret, and so is a field the step does not define. The field name is never consulted. The atoms' internal `zl-input`, `zl-change` and `zl-passkey-result` events are no longer composed, so they stay inside the widget, and the `input` event a field re-publishes carries no typed character for a secret field. Code that reads `detail.value` from `onFlowInput` (or the Vue, Angular and Svelte equivalents, or a raw `zitadel-flow-input` listener) must check `detail.secret` first. The `<zitadel-login>` element also no longer returns what a visitor typed or the flow's session token from any property or method, which are now ES-private, so a script holding the element, or the target of an event, cannot read them from there. This does not hide the widget from the page: an open shadow root lets a script read an atom's `value` and `<input>`, including through an event's `composedPath()`; the browser's own keyboard, `beforeinput`, `textInput` and `input` events are composed, so removing the `data` of the `input` a field re-publishes is only defence in depth; `getSelection().toString()` reads a non-password text field such as a PIN or a card number once its text is selected; and `zitadel-flow-complete` still carries the `handoff_token`. Only a cross-origin iframe isolates the widget. The types in `@zitadel/sdk-core` and every SDK are updated and `ZitadelFlowInputEventDetail` is exported from `@zitadel/components`.
