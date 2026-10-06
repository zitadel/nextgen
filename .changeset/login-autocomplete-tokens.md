---
"@zitadel/components": minor
"@zitadel/config": minor
"@zitadel/server": minor
---

Password managers and browser autofill now work across the sign-in and
registration screens, including the two-step layouts where the password is
asked for on its own.

- The login reads the `autocomplete` token the server sends for each field
  instead of guessing from the field or step name, so a renamed identifier
  property or a renamed step gets the right token.
- A step that asks for the password alone now carries the identifier collected
  earlier, hidden in the same form, so a manager saves the two as one
  credential and offers to fill them together next time.

Ejected templates pick this up by replacing their `autocomplete` guesswork with
the field's own `autocomplete` value; the hidden identifier needs no template
change.
