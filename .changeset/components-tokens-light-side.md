---
"@zitadel/components": patch
---

`@zitadel/components/tokens` also re-exports `tokensCss` and `THEME_SELECTORS`
from `@zitadel/design-tokens`, so a consumer can read the light side's values,
which the `tokens` object does not hold.
