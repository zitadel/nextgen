---
"@zitadel/server": minor
---

Flow steps now tell the client how to tag each input for password managers and
browser autofill. Every field carries an `autocomplete` token — `username` or
`email` on the identifier your schema designates, `current-password` where the
password is verified and `new-password` where a new one is saved — and a step
that collects a password without collecting the identifier also carries the
identifier collected earlier, so a form can hold both and a manager can store
them as one credential. A custom login template can read either from the step
payload instead of guessing from field or step names.
