---
"@zitadel/server": minor
---

Upgrading recreates the variables table and drops every stored variable: enter your variables again through `PATCH /variables` after the upgrade. The store now holds a value per target kind, `primary` or `preview`, and can freeze the values a deployment is created with as a set that later changes to the variables do not touch. The API reads and writes the primary values only until a preview value can be entered.
