---
"@zitadel/cli": patch
---

Every question the CLI asks now reads as a plain question to you, such as "What is the client ID of your Google OAuth app?" and "Would you like to deploy .zitadel/ to it now?", instead of a bare field name like "Client ID" or "Server URL". The questions that ask for a provider's client ID and secret read the same in `zitadel setup` and `zitadel auth-method sso enable`, and the client secret question says which project variable will hold it.
