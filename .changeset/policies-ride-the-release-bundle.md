---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /releases/build` now takes operation policies under `policies`, each the body `POST /policies` takes, adds a revision only for a changed one and pins each; building them needs `policy.write` ([docs](https://preview.zitadel.com/docs/reference/api/releases/buildRelease)). A sign-in or sign-up applies the policy its release pins, none when it pins none, and the newest revision when no release resolves.
