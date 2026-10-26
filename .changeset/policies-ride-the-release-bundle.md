---
"@zitadel/server": minor
"@zitadel/api": minor
---

A release bundle can carry operation policies, and a sign-in or sign-up uses the policy its release pins. `POST /releases/build` takes them under `policies`, each the body `POST /policies` takes, and publishes them inside the release's transaction: an unchanged config reuses the operation's newest revision, a changed one adds a revision, and the release pins it under the new `policy` pointer kind, with the operation as its handle. A config the template refuses beyond the request's own validation, such as a minimum above the maximum, or two policies for one operation, gets a `rel.invalid` entry, and building one needs `policy.write`. A request whose release pins a flow now applies the password policy that release pins, like the user schema, branding and identity providers, and no policy when the release pins none. A request that resolves no release still applies the newest revision.
