---
"@zitadel/server": minor
---

Build a release from a `.zitadel/` configuration bundle in one request (`POST /releases/build`): every resource failure is reported at once under `400 rel.invalid`, matching content reuses any prior revision (so rebuilding older content returns the existing release without allocating), and a missing handle answers `rel.unresolved_reference`.
