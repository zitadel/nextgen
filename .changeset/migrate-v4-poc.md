---
"@zitadel/server": minor
---

`nextgen migrate-v4` (proof of concept) migrates a Zitadel v4 instance into a nextgen project by reading v4's PostgreSQL database directly. Organizations become teams, human users become users with their v4 password hashes, generic OIDC and Google identity providers become IdP connections with their client secrets, and users' IdP links become identity links. `assess` reports what migrates and what does not, `run` can be repeated while v4 keeps serving and converges nextgen to v4's current state, and `verify` checks the result.
