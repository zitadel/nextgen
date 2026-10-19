---
"@zitadel/cli": minor
"@zitadel/server": patch
---

Add `zitadel test sign-in`, which checks that the sign-in providers are set up correctly before anyone signs in. It checks every connection the project has, one block each, and `--provider <slug>` checks just one. It reads the provider's discovery document and checks the issuer, the scopes and the claims the connection asks for, asks the provider whether it accepts the client and the callback URI. These checks make plain HTTP requests, need no browser and never need the client secret, which the platform stores write-only. Each prints as it finishes and ends in `pass`, `warn`, `fail` or `skipped`; a check that cannot tell is `skipped`, never a pass, and a failure exits with `E_VALIDATION` and the one thing to do about it. The provider answers are known for Google today; any other provider runs the discovery checks only.

`--live` adds a real sign-in: it opens the login page, waits for you to sign in, and reports from the runtime's log which phase failed and on which side, provider or journey. It is off by default. To support it the server now logs one event for each phase of a social sign-in, with the connection, the flow and the phase, and on failure a reason and the side that failed. The events never carry authorization codes, tokens, secrets or claim values.
