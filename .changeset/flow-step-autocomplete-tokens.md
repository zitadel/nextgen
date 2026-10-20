---
"@zitadel/server": minor
---

Flow steps now tell the client how to tag password and identifier inputs for
password managers and browser autofill.

- **Identifier and password fields carry an `autocomplete` token.** The
  identifier your user schema designates gets `username`, including when it is
  an email address — that is the token a password manager pairs with a
  password. A password gets `current-password` where it is verified and
  `new-password` where a new one is saved. Every other field carries none.
- **A password step carries the identifier collected before it.** When a step
  asks for a password but not the identifier, it also returns the identifier
  from the earlier step, so one form can hold both and a manager saves them as a
  single credential.

Both come from the schema designation and the flow's purpose, so renaming the
identifier property or a step no longer changes which tokens appear. The bundled
login UI adopts them separately.
