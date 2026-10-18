---
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
---

Every SPA SDK now writes the widget's configuration into server markup from one function, `widgetAttributes` in `@zitadel/sdk-core/attributes`, instead of its own list. The attributes no longer differ between SDKs: a server-rendered `ZitadelLogin`, `ZitadelSession` or `ZitadelLogout` carries the same `project-id`, `proxy-path`, `url`, `purpose`, `flow-name`, `post-sign-in-url`, `resume-flow-id`, `post-sign-out-url`, `heading`, `logout-label`, `variant`, `theme`, `lang`, `suppress-header` and `suppress-password-toggle` that apply to it, in every SDK. The `project` handle wins over `projectId` and `proxyPath`, an empty proxy path is written as `/`, and a handle that carries a publishable key writes no project attributes, in all of them. React, Solid and Svelte now include the display options that only Vue and Angular wrote before.
