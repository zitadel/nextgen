---
---

The claim service (#611) now backs claim init/status/complete inside the server, but the HTTP handlers are not wired until #612, so the endpoints keep answering 501 and no shipped behavior changes.
