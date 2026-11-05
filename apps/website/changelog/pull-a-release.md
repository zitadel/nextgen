---
title: Rebuild your .zitadel folder from a release
summary: zitadel pull restores the files of the live release, or of any release or deployment, so the next deploy builds the same release.
date: 2026-10-27T23:26Z
pulls: [1407]
---

`zitadel pull` rebuilds `.zitadel/` from what a release pins: the live release by default, a release id (`rel_…`) or a deployment id (`dep_…`). The next `zitadel deploy` then builds the same release.

It restores schemas and flow definitions, and warns for branding and identity provider connections, which it cannot read back yet.

[zitadel pull](https://preview.zitadel.com/docs/reference/cli/pull)
