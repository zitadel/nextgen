---
"@zitadel/components": patch
"@zitadel/config": patch
---

fix: the `split`, `split-right` and `hero` designs keep "Secured with Zitadel" 24px below the card, as the centred design does. It hung off the page-shell footer, which spans both panes, so the brand pane's height decided the distance — over 100px on a tall pane. Those templates now carry a `data-zl-attribution-anchor` in their form column; a template without one still uses the footer slot. The split brand pane is also smaller: `--zl-spacing-8` block padding, and an 18rem placeholder with `--zl-split-hero-max-height` tracking it at 22.5rem.
