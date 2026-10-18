---
"@zitadel/sdk-qwik": patch
---

Emit the widget config as attributes (`project-id`, `proxy-path`, `url`, `purpose`, `post-sign-in-url`,
`post-sign-out-url`, `resume-flow-id` and the rest) so Qwik's resumed server markup is configured the moment the widget
upgrades, instead of only from the `ref` callback and `useVisibleTask$`.
The project's publishable key travels the same way.
Widget events that fire before the visible task attaches the `on…$` callbacks (such as `zitadel-flow-complete` from an already finished resumed flow) are held and replayed to them instead of being lost. Only the wrappers' own widgets are buffered, and only their terminal events (complete, redirect, error, signout, at most eight per widget); input and step events, which carry field values, are never stored.
