---
"@zitadel/server": patch
---

The console now opens on Users instead of an empty Teams page, after
`zitadel console`, sign-in and "Open the console" after a claim, so the people
who signed up through your app are the first thing you see. The Users table
shows each value once: a user's email no longer repeats across the User,
Identifier and Email columns under the default user schema, the identifier sits
under a display name when the schema has one, and the table fits a 1024px
window without scrolling sideways (a long user ID is shortened, with the full
ID in its tooltip).
