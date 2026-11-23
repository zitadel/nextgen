---
"@zitadel/cli": minor
---

A command line the CLI refuses no longer repeats the framework's own error text under `details` in the `--json` envelope; the failure carries one coded message and the command's help as its next step, like every other failure. Breaking: a script that read `details.original` from such a failure no longer finds it. Every command's `--json` failure is now checked in the shared envelope assertion for a documented code and no framework wording.
