---
"@zitadel/cli": patch
---

Set the now-required `kind` on the default flow's step actions: submit actions use `submit`, the register/login routing actions use `navigate`. Without it, the generated flow fails validation against the updated flow-definition schema.
