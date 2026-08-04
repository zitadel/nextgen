---
"@zitadel/cli": minor
---

The setup wizard now asks how the login should look: keep the preselected
built-in template (writes nothing), or pick one of the five starter designs
(centered, split, split-right, hero, minimal) to eject it into
`.zitadel/branding/` and publish it as branding revision 1 during setup.
`--design` answers the question non-interactively, as before. The chosen
design is reported in the summary box, the JSON envelope (`data.design`,
`null` for built-in), and the setup retry hint, and setup's next actions
now point at the branding workflow — edit/plan/apply when a design was
ejected, `branding eject` when not.
