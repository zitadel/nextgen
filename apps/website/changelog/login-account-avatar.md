---
title: The password step shows the account with an avatar
summary: The login's password step shows the account as a chip with a generated avatar, and a GitHub sign-in button shows the GitHub logo.
date: 2026-10-27T23:26Z
pulls: [2231, 2236]
---

The password step of `<zitadel-login>` shows the account as a full-width chip that goes back to use another account, with an avatar generated from the typed identifier, so it never confirms that an account exists. The console shows the same avatar.

- Custom templates get the chip as `<zl-account>`, and `<zl-avatar>` and `@zitadel/components/avatar` export the avatar for your own pages.
- A GitHub sign-in button shows the GitHub logo, in the button's text colour in light and dark mode. Google's logo is unchanged, and providers without a brand icon, such as custom OIDC connections, stay text-only.

[Customize the design](https://preview.zitadel.com/docs/guides/customize-design)
