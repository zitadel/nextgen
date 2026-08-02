---
"@zitadel/testing": minor
---

Add `enableVirtualPasskey(page)` and the on-demand `passkey` Playwright
fixture to the test-kit: a CDP virtual authenticator (platform authenticator,
discoverable credentials, automatic user presence) that lets tests complete
real passkey registration and login ceremonies headlessly, plus
`credentialCount()` for asserting credential reuse. Chromium projects only,
and the app under test needs an origin WebAuthn accepts as a relying-party
ID: HTTPS, or `http://localhost` for local tests — raw IP origins are
invalid.
