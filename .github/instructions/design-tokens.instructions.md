---
applyTo: "packages/design-tokens/figma-export/**,packages/design-tokens/src/generated/**"
---

# Design Token Sync Review Instructions

Both of these directories are machine-written. `figma-export/**` is pushed by
the Figma sync plugin to branch `design-tokens/figma-sync`;
`src/generated/**` is produced from it by `:sync-export` and `:generate`.
Do not ask an author to hand-edit either — the next sync overwrites the file.
Corrections to a token's name, value, or description belong in the Figma
library. See [`packages/design-tokens/AGENTS.md`](../../packages/design-tokens/AGENTS.md).

Three properties of this pipeline routinely read as defects but are not:

- **`$metadata.modes` order carries no contract.** `scripts/sync-from-export.ts`
  resolves modes by name (`findMode()` matches the declared mode names
  case-insensitively against `light` / `dark`). Nothing indexes into the array,
  so a Light/Dark reorder in an export is plugin churn, not a breaking change.
- **`$description` is inert.** `flatten()` skips every `$`-prefixed key and
  `isLeaf()` keys off `$value` alone, so a description never enters the alias
  registry or any generated artifact. A description that disagrees with its
  token is a note to pass to design, not a code change.
- **Brand grays are not the semantic gray ramp.** `{brand.gray.N}` resolves
  through `figma-export/brand.json`; `--zl-color-gray-N` is a separate semantic
  ramp offset by one step (`brand.gray.400` and `--zl-color-gray-300` are both
  `#686883`). Resolve an alias against `brand.json` before calling the export
  and the generated output inconsistent.

What is worth reviewing on a sync PR:

- **Value changes that cross a contrast threshold.** A token is a colour on a
  known surface; check the new value against its theme background rather than
  the diff alone. Syntax and disabled-text tokens sit near the WCAG AA 4.5:1
  line, so a small hex move can drop readable text below it in one theme only.
- **A red snapshot check**, which means a token name changed. Consumers and
  `src/tokens.snapshot.spec.ts` update together, or the sync rolls back.
- **Unclassified or stale collections** reported in
  `$source.unclassifiedCollections` / `$source.staleCollectionRoles`. Roles are
  declared in `src/collections.ts`, never inferred.
