---
---

Harden the Biome rule set to error-or-off with no `warn` tier. This is a
build/lint-config change: enabling the a11y and correctness rules required
small conformance touch-ups in `apps/console` components — SVG `<title>`
elements, a semantic `<fieldset>`, explicit `type="button"`, and stable list
keys — but these are lint corrections with no change to what the console does
for a user, so no package version ships.
