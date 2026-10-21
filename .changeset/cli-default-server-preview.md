---
"@zitadel/cli": patch
---

`zitadel setup` without `--server`, and the setup wizard's Zitadel Cloud choice, now target the hosted preview at `https://preview.zitadel.com` instead of `https://api.zitadel.cloud`. A project whose `zitadel.json` names a server keeps using that server.
