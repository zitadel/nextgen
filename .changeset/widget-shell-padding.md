---
"@zitadel/shared-component-styles": patch
"@zitadel/components": patch
---

fix: `variant="widget"` no longer pads around the card. The internal page shell kept its full-page padding chrome (52px vertical at desktop widths) in widget mode, so `<zitadel-login>`/`<zitadel-session>` embedded in an app's own container rendered with dead space above and below the card — a 682px host around a 514px card. Widget mode now sheds the shell padding along with the background and viewport sizing it already dropped, making the host box hug the card as the content-sized embedding contract promises. `variant="page"` is unchanged.
