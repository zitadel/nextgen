---
"@zitadel/server": minor
---

The console's user detail screen now edits a boolean attribute with a switch and saves it as `true` or `false`. Optional fields are marked "Optional" beside their label. A cleared required field now says "This field is required." next to it, and a partly cleared date keeps Save off instead of deleting the stored date. An unsaved edit now survives a switch to the Authentication tab and back. The fields are locked while a save runs, so nothing typed meanwhile is lost.
