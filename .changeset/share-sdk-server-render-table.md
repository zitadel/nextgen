---
---

Hold every SDK to the same server-render attribute table. The shared
`server-render-cases` block — the widget-config attributes the elements read,
each SDK's current server markup, and the gaps where a markup does not write one
yet — now lives in the Solid and Qwik SSR specs too, alongside React, Vue,
Svelte and Angular, and the block gained the empty-proxy-path, heading and
logout-label cases that document the drift between them. `sdk-core`'s contract
spec checks all six copies stay identical. Test only — the files each SDK runs,
and everything a consumer installs, are unchanged.
