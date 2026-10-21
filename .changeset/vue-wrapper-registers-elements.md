---
"@zitadel/sdk-vue": patch
---

The Vue entry now imports `@zitadel/components` itself to register the widget elements in the browser, like every other client entry, and loads on edge runtimes, where the components package has no elements and the import does nothing.
