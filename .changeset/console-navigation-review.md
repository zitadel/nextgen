---
"@zitadel/server": patch
"@zitadel/config": minor
---

Console fixes from the navigation review (#2239): a number on Settings is typed as text, so a half-typed value is sent as typed instead of deleting the attribute; saving the profile refreshes only the session instead of every cached read and the CSRF token; search drops team results the typing has ruled out; ⌘K toggles once per press and not over another dialog; the Teams title sits on the shared title row; the theme control uses the menu's radio items. `@zitadel/config` adds `@zitadel/config/server` with `DEFAULT_SERVER`, the server the CLI targets by default, which the CLI and the console now share.
