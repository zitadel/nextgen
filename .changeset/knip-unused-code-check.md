---
---

The published packages now check for unused files, exports and dependencies when they are linted. Unused code and dependencies are removed, and the packages' public API is unchanged. The native server platform packages declare `"type": "module"` so their lint config loads; they ship only the server binary, so nothing changes for them either. Nothing a consumer imports changes.
