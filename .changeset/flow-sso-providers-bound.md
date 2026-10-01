---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
---

A flow step offers at most 20 `sso_providers`. The flow definition API and
the editor schema both reject a longer list. The render reads the step's
whole slug set in one lookup instead of one per slug; the rendered step is
unchanged.

**Breaking:** creating a flow definition whose step lists more than 20
provider slugs now fails with a 400. No shipped flow comes near the bound.
