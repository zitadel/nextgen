---
"@zitadel/cli": minor
---

Adds `zitadel pull`, the inverse of `deploy`: it rebuilds `.zitadel/` from the revisions a released snapshot pins, so a working copy matches what a release shipped. The target is the live release by default, a release id (`rel_…`), or a deployment id (`dep_…`) whose release is pulled. Each pinned revision is read back and written to its resource's file by handle, overwriting an existing file for the same resource rather than leaving a second one, so the next `deploy` rebuilds the same release. A release references each resource by handle, so pull needs no id-to-handle rewrite.

Pull rebuilds the kinds whose pinned revision the per-kind read endpoints can resolve — schemas and flow definitions. A release that also pins branding or an identity-provider connection is pulled for the kinds it can and warns for the rest, which gain a pull path once their reads are revision-addressable.
