---
title: Edit a user's attributes in the console
summary: The console's user screen follows the new design, edits a user's attributes against their schema, and shows which schema revision the user is on.
date: 2026-10-21T16:38Z
cloud: true
pulls: [1885, 2142, 2135]
---

The console's user detail screen follows the updated design. Overview heads the profile with the user's schema and the schema revision the user is on, which links to that schema. It saves edited attributes with a Save button: only the changed attributes are sent, and a cleared optional field is removed.

- A boolean attribute is a switch that saves `true` or `false`.
- Optional fields are marked "Optional" beside their label, and a cleared required field says "This field is required."
- A partly cleared date keeps Save off instead of deleting the stored date, and an unsaved edit survives a switch to the Authentication tab and back.
- The Authentication tab lists the passkey state, with when the passkey was verified, and the identity providers in the same style.
