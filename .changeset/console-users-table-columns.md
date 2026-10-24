---
"@zitadel/server": patch
---

The console's Users table keeps its width bounded however many properties a
schema has. The User column and the row menu stay in view while the table
scrolls, schema properties are hidden until you pin them from the new Columns
menu (remembered in your browser), and everything else reads in one Attributes
column that opens the user's full attributes as JSON or YAML. The User cell
names the property each user signs in with (`email`, `username`), hovering a
user explains their identity, and the Team column is now "Member of", tagging
pending and inactive memberships.
