---
"@zitadel/cli": minor
---

`zitadel setup` reports what sign-in is configured to do, in every mode, not
only in the wizard. Its summary box has a *Sign-in* section, and `--json`
carries `data.sign_in`: the method the login starts with, every method the
user schema enables (`password-first` enables passkeys too), each registration
field and whether it is required, the minimum password length and the external
providers. The wizard's note now names the optional fields as well.
