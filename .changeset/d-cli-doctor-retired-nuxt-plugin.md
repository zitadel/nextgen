---
"@zitadel/cli": patch
---

`doctor --fix` now clears the record of `plugins/auth.server.ts` from a Nuxt app an older setup
wrote, once the file is deleted. Setup no longer writes that file, so `doctor` previously kept
failing on it and `--fix` could neither restore nor drop it.
