---
"@zitadel/server": patch
---

The console's users list places each user's identifier directly before their
ID, tagged with the property it comes from (`email`, `username`, …) when the
list mixes user schemas, and the ID gains a copy button. Hovering a row
highlights its identifier, the attribute column it is read from, and that
column's header, in a colour per property that meets WCAG AA contrast in both
themes. Attribute columns also keep a stable order between loads; before,
they could reshuffle depending on which schema loaded first.
