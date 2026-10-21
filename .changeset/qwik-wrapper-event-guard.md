---
"@zitadel/sdk-qwik": patch
---

The Qwik wrappers now hand a widget event to your `on…$` handler only when it is a custom event with a detail, instead of reading the detail from any event, and the entry says that it registers the elements in the browser only.
