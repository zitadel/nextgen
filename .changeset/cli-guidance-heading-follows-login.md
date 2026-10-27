---
"@zitadel/cli": patch
---

The `AGENTS.md` section `zitadel setup` writes now says that the login moves between sign-in and sign-up by itself, so a page heading shown in place of the widget's own (`suppress-header`) has to follow the login's `zitadel-flow-step` event, and that `locales` rewords the widget's heading instead. Before, it suggested a fixed heading, which read "Sign in" while the login asked a new visitor to sign up. The comment in the login page `setup` adds to an existing Next.js app says the same.
