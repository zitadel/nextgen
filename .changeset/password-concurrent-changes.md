---
"@zitadel/server": patch
---

Setting a user's password from several requests at once no longer fails with an internal error. Each change now succeeds: the one that finishes last becomes the current password, and the ones it replaced stay in the password history. A password set while the server's clock reads earlier than the user's newest password, for example after a clock correction, now also becomes current instead of leaving the old one in place.
