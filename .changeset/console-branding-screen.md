---
"@zitadel/server": minor
"@zitadel/components": minor
---

The console has a branding screen.

Appearance settings sit beside a live preview of the project's own login: the real `<zitadel-login>` against a real flow, so what a customer checks their colours on is the flow their project actually serves rather than a mock of it. Editing a value repaints the preview, and contrast warnings count per theme as the palette changes.

`<zitadel-login>` gains a `brandingOverride` property for that preview. It paints the branding it is given instead of the revision the flow carried, which is what lets an editing surface show unpublished values; the published revision still governs every other visitor.

Publishing, restoring the maintained design, and the per-state previews come next.
