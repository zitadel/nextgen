---
"@zitadel/sdk-qwik": patch
---

Emit the widget config as attributes (`project-id`, `proxy-path`, `url`, `purpose`, `post-sign-in-url`,
`post-sign-out-url`, `resume-flow-id` and the rest) so Qwik's resumed server markup is configured the moment the widget
upgrades, instead of only from the `ref` callback and `useVisibleTask$`.
The project's publishable key travels the same way.
An explicit `project` handle is also marked `project-explicit`, so a resumed widget keeps it over a different global from `configureZitadel()`.
