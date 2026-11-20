---
"@zitadel/testing": patch
---

`bootLocalServer` retries on a fresh port, up to five times, when another process takes the port it picked before the server binds it, so booting many servers at once no longer fails with `E_PORT_IN_USE`. A port passed explicitly is still taken as asked or refused.
