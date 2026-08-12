---
"@zitadel/testing": minor
---

`withZitadel()` now accepts suites with no app server of their own: omit `app`
and it generates only the instance entry, for tests that drive the surfaces
the Zitadel binary serves itself (`/ui/console/`, `/ui/login/`). `appOrigin`
must then be the instance's own local origin. Existing configs are unaffected.

The `zitadel` worker fixture now waits for the handshake file instead of
reading it once: the instance's health endpoint answers before bootstrap
finishes writing the handshake, a gap only app-less suites could hit.
