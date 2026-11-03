---
"@zitadel/server": minor
"@zitadel/components": minor
---

Protect Flow API password signup with built-in PBKDF2 proof of work, a browser
solver, single-use proofs and fixed per-project rate limits. Custom/headless
signup clients must solve `step.gates.signup_pow` and submit `gate_proofs.signup_pow`.
