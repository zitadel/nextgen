---
"@zitadel/server": patch
"@zitadel/components": patch
---

Flow field validation errors now travel as localisation keys instead of
developer strings: `step.error` carries `error.<field>_<rule>` per violation
("; "-joined, format spelled `_invalid` to match the catalog), and the login
components localise them — catalog-known keys render inline on their field,
unknown fields resolve through new generic `error.field_<rule>` fallbacks
interpolated with the step's field label (en/de/it). A key routed inline whose
field is not on the step downgrades to a visible banner message instead of
disappearing. Users see "Please enter a valid email" instead of
"flow field email: format".
