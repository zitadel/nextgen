---
"@zitadel/cli": patch
---

Polish the claiming journey copy: setup's end-of-run nudge now names the claim
deadline and the data-loss stake, the pre-browser message and the claim success
output speak in claim/permanence terms, and the team id moved out of the human
success output (it stays in the JSON envelope and `.zitadel/secret`). The setup
summary's INSTALLED section now reports the SDK package the scaffold actually
added and recognizes every supported framework's artifacts instead of always
claiming `@zitadel/sdk-next` with Next.js file paths.
