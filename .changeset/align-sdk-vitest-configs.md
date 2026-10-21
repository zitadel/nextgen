---
---

Align the Vitest config shape across every SDK. `@zitadel/sdk-react` placed
`setupFiles` after `exclude`, where every other SDK's project lists it right
after `environment` and before `include`; move it there so the inline project
blocks read the same everywhere. Test config only — the files each SDK runs,
and everything a consumer installs, are unchanged.
