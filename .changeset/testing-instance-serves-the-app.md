---
"@zitadel/testing": minor
---

`withZitadel()` now accepts suites with no app server of their own: omit `app`
and it generates only the instance entry, for tests that drive the surfaces
the Zitadel binary serves itself (`/ui/console/`, `/ui/login/`). `appOrigin`
must then be the instance's own origin. Existing configs are unaffected.
