---
"@zitadel/server": patch
---

Adding a user in the console now marks each value the server refuses on its own field, with what the user schema expects there (a whole number, at most 50 characters, an email address), instead of only a general error. A yes/no attribute is a switch rather than a text box, so it can no longer be sent as text the schema rejects.
