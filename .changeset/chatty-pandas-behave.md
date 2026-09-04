---
"@zitadel/cli": minor
---

Clearer claim journey output: commands now sit on their own styled line in the setup box (triple-click copies exactly the command), the end-of-setup notice states the concrete date until which the temporary project can be claimed, terminal boxes wrap to the window width instead of breaking their frame below 80 columns, and `zitadel claim` explains a closed 14-day claim window instead of suggesting a futile retry. The temporary-project nudges now also appear for CLI-launched local servers, which host their own claim page, not just the cloud; only self-hosted servers stay silent.
