---
"@zitadel/components": patch
"@zitadel/server": patch
---

Login-widget fixes from alpha.18 team feedback:

- The identifier step's primary button now says "Continue" ("Weiter" /
  "Continua") instead of "Sign in". The step branches to registration when
  the email is unknown, so "Sign in" promised an outcome the step cannot
  guarantee.
- The widget no longer paints a focus ring on the primary action when a
  page-mode flow loads on a field-less step (e.g. the passkey-first
  preset's entry step). Script-moved focus with no prior interaction
  matches `:focus-visible`, which made the ring read as a pre-selected
  state. Initial focus now lands only on input fields; step swaps keep
  moving focus to the first control, where the browser derives the ring
  from the user's actual input modality.
