---
"@zitadel/cli": minor
---

Clearer claim journey output: commands now sit on their own styled line in the setup box, separated from the prose so they can be copied without surrounding words, the end-of-setup notice states the concrete deadline (date, time, and zone) until which the temporary project can be claimed, terminal boxes wrap to the window width instead of breaking their frame below 80 columns, and `zitadel claim` explains a closed 14-day claim window instead of suggesting a futile retry. `zitadel setup` now also nudges against a local server when that server hosts the platform plane (probed via its runtime document), where the claim can actually complete; the offline surfaces (`status`, `doctor`) keep their cloud-only nudges.
