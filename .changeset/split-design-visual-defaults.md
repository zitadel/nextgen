---
"@zitadel/components": patch
"@zitadel/config": patch
---

Split-family login designs now look intentional out of the box. The brand pane renders a token-gradient placeholder panel until `branding.json` names a `logo_url`/`hero_url`, so a fresh `split`/`split-right` eject reads as a split layout instead of a lonely off-centre card. The "Secured with Zitadel" attribution now aligns under the form column in split-family designs (it previously centred across both panes) and recentres when the layout collapses to a single column on narrow containers.
