---
"@zitadel/server": minor
---

In the console, the Users list's revision filter picks one schema revision, or `Older revisions` for every user not yet on the newest. Its `Latest only` choice is gone: pick the newest revision instead, and a link carrying `revision=latest` opens the schema's whole list. The revision menu there and on a schema's detail page shows each revision the same way: a shortened id, its creation time, and `Latest` and `In use` badges. An older revision no longer carries a note and migration-guide link under Field definitions; its badges say where it stands. Ids that do not fit their slot are cut in the middle, keeping their start and the end that tells them apart (`user_0…PQFJA0`, `https://part…/v2/profile.schema.json`): in id columns, the revision pickers, a schema's id under its title, and a user's revision box.
