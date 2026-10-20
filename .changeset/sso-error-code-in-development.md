---
"@zitadel/server": minor
"@zitadel/components": minor
---

On a local development server (`zitadel start`), a sign-in provider that cannot be reached now shows its error code, such as `idp.discovery_failed`, under "This sign-in provider is not available right now", and `<zitadel-login>` logs it to the browser console. A server on any other address keeps showing only the message.
