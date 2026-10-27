---
"@zitadel/components": minor
"@zitadel/config": minor
"@zitadel/server": minor
---

The password step of `<zitadel-login>` now shows the account it signs in to as a full-width chip with a generated avatar, and the whole chip takes the visitor back to use another account. The avatar is generated from the identifier the visitor typed, so it never confirms that an account exists, and sign-up steps show the chip without it, since no account exists yet. The SSO-conflict step shows the provider's email the same way, without the switch. The console's avatar is now generated from the same identifier, so a person sees one avatar in the login and the console. Custom templates get the chip as the new `<zl-account>` atom (`identifier`, optional `action`, `label` and `avatar`), and `<zl-avatar>` and the `@zitadel/components/avatar` entry export the avatar for your own pages: `avatar.css` paints it, and the `zl-avatar-moving` class sets its direction drifting, as the console's does.
