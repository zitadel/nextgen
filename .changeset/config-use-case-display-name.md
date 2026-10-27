---
"@zitadel/config": patch
"@zitadel/cli": patch
---

`zitadel setup --use-case consumer` and `--use-case business` now make a user's given and family name their display name (`x-display`), so a signed-in session reads "Ada Lovelace" instead of only the email: `getSession()` returns it as `display`, and `<zitadel-session>` shows it. A project set up earlier gets the same by adding `"x-display": ["givenName", "familyName"]` to its user schema and running `zitadel deploy`; users who sign up after that show their name.
