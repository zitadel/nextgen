---
"@zitadel/config": patch
"@zitadel/cli": patch
---

`zitadel setup --use-case consumer` and `--use-case business` now make a user's given and family name their display name (`x-display`), so a signed-in session reads "Ada Lovelace" instead of only the email, in `getSession()` and `<zitadel-session>`.

**Upgrading a project set up earlier:** add `"x-display": ["givenName", "familyName"]` to its user schema and run `zitadel deploy`; users who sign up after that show their name.
