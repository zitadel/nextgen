---
"@zitadel/cli": patch
---

Polish the claiming journey copy: the claim nudges in `setup`, `status`, and
`doctor` now name the claim deadline and the data-loss stake, the `claim`
command's help text, pre-browser message, and success output speak in
claim/permanence terms, and the team id moved out of the human success output
(it stays in the JSON envelope and `.zitadel/secret`). The setup
summary's INSTALLED section now reports the SDK package the scaffold actually
added and recognizes every supported framework's artifacts instead of always
claiming `@zitadel/sdk-next` with Next.js file paths.
