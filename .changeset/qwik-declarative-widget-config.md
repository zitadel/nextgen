---
"@zitadel/sdk-qwik": patch
---

Emit the widget config as attributes (`project-id`, `proxy-path`, `url`, `purpose`, `post-sign-in-url`,
`post-sign-out-url` and the rest) so Qwik's resumed server markup is configured the moment the widget
upgrades, instead of only from the `ref` callback and `useVisibleTask$`.
