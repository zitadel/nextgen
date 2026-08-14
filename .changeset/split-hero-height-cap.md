---
"@zitadel/components": patch
---

A `hero_url` no longer decides how tall the sign-in page is. In the `split` and
`split-right` designs the brand pane took its height from the image, so an asset
that is tall, square, or an SVG with no width/height of its own — the kind every
framework scaffold ships in `public/` — stretched the pane past the viewport and
pushed the "Secured with Zitadel" attribution below the fold. The hero now spans
the brand pane's width with a capped height: a conventional wide banner renders
exactly as before, and a taller asset is cropped to fit instead of growing the
page. Set `--zl-split-hero-max-height` on the template root to raise or lower the
cap for a design that wants a taller pane.
