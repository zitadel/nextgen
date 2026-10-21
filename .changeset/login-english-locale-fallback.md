---
"@zitadel/components": patch
---

`<zitadel-login>` now falls back to your `en` entries in `locales` for any text
the visitor's language has none for. A step you labelled only in English reads
in English for every visitor instead of showing raw keys, and visitors in a
language without built-in texts, such as French, see the English texts you
changed. Built-in German and Italian translations still win over your English;
add `de` or `it` entries to change those.
