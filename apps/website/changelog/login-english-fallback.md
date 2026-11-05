---
title: Your English texts reach every language of the login
summary: <zitadel-login> now falls back to your en entries in locales for any text the visitor's language has none for, instead of showing raw keys.
date: 2026-10-21T22:08Z
pulls: [2175]
---

`<zitadel-login>` now falls back to your `en` entries in `locales` for any text the visitor's language has none for. A step you labelled only in English reads in English for every visitor instead of showing raw keys, and visitors in a language without built-in texts, such as French, see the English texts you changed.

The built-in German and Italian translations still win over your English: add `de` or `it` entries to change those.

[Customize the login's copy](https://preview.zitadel.com/docs/guides/customize-copy)
