---
"@zitadel/components": patch
"@zitadel/ui-react": patch
---

Fix `<zl-select>` / `<Select>` rendering a duplicate empty option when a
schema `enum` explicitly lists `""` as an allowed value. The leading
placeholder row now drops any empty-valued member of the caller's options
first, so the native `<select>` and the styled list show a single empty
row (and React no longer sees duplicate keys). The React `<Select>` also
treats an empty current value as "no selection", so the trigger stays on
the placeholder even when an empty option exists upstream.
