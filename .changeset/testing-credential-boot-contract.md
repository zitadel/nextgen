---
"@zitadel/testing": minor
---

Define the kit's credential surface on `InstanceHandle` as the sanctioned boot
contract (root ADR 052 §9: test infrastructure obtains credentials through the
testkit's boot contract, never through a seed default). `projectSecret` is
documented as captured from provisioning output, and a new optional `platform`
slot (`PlatformCredentials`: reserved platform project id, publishable key,
scoped `sk_plat_` automation key, pre-minted operator session) fixes the
platform-plane shape ahead of the server-side provisioner — it stays
unpopulated until that lands, and no server test-mode door exists or may be
added. `AppEnvTemplate` now accepts only the handle's flat string fields
(structured fields were never valid env-var material and now fail at compile
time), and handshake files validate the `platform` block on read.
