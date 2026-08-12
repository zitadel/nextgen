---
"@zitadel/server": patch
---

Ignore-case list filters (contains, starts with, ends with) now lowercase both the column and the search term inside the database. Searching for a value exactly as stored always finds the row, even when the database's LOWER disagrees with Go's lowercasing (for example C-locale PostgreSQL or SQLite).
