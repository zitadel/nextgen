---
---

The published packages now check for unused files, exports and dependencies when they are linted, with no change to what the packages build. The native server platform packages declare `"type": "module"` so their lint config loads; they ship only the server binary, so nothing changes for them either. Nothing a consumer imports changes.
