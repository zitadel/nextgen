---
"@zitadel/components": patch
---

Custom flow steps no longer render a raw `<step>.action.back` key on the back
button: the `| t` filter now falls back to a generic `action.back` entry
(shipped in en/de/it) when a step-specific key is missing. Step-specific keys
still win when defined.
