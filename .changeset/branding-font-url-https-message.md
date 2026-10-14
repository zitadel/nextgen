---
"@zitadel/config": patch
---

`zitadel plan` now rejects an `http` `typography.font_url` with the message `zitadel apply` gets from the server: `typography.font_url must be an absolute https URL`. It no longer adds that http is allowed for loopback development hosts, which holds for logo and hero URLs but never for a font stylesheet.
