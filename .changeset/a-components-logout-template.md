---
"@zitadel/components": patch
---

`<zitadel-logout>` template mode now shows the projected control: it was cloned into the light DOM
but never rendered. The template may also be built with DOM calls (as JSX frameworks do) or
appended right after the element connects.
