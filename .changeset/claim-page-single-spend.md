---
"@zitadel/server": patch
---

Claiming a project no longer ends on "Already claimed" after it has just succeeded. The claim page could spend the same claim link twice, and the second attempt — which the server refuses, because a claim link is single use — replaced the confirmation with a message saying another team owns the project. The claim itself was always recorded correctly; only the screen was wrong.
