---
"@zitadel/server": minor
---

The console users list gains the Team column from the design: each row shows the user's team as a chip, with an exact `+n` indicator when the user belongs to further teams and search matching team names like every other column. Team data is read per row from the user's team roster and degrades to an empty cell when it cannot be loaded.
