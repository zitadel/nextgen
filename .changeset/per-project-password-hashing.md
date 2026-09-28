---
"@zitadel/server": minor
---

Let a project choose the method its passwords are hashed with (ADR 029 §Hashing). `PATCH /projects/{project_id}` takes a `password_hash` of an algorithm and its cost parameters, and `null` hands the project back to the server default. Verification is unchanged and deployment-wide, so stored passwords keep working across a change; only the next password written moves. A method is accepted only if the deployment can verify it and its cost sits inside the configured limits, which now cover scrypt, pbkdf2 and sha2 as well as bcrypt and argon2.
