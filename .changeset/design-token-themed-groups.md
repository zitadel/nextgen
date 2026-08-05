---
"@zitadel/design-tokens": patch
---

Declare what each Figma collection is, and surface every one the designer
pushes.

`sync-from-export` inferred a collection's role from its shape: "the Light/Dark
one is the semantic colour surface, anything else multi-mode is viewport
typography". Once Figma shipped `Syntax` and `Gradient Colors` — both Light/Dark,
neither semantic — that put two collections in one bucket keyed only by mode
name, and the later-sorting file replaced the earlier one outright.
`Gradient Colors` resolved, was counted in `resolvedLeaves`, and then left the
pipeline without a trace.

- Roles now come from `src/collections.ts`, keyed by Figma collection name:
  `semantic` | `themed` | `viewport` | `primitives` | `registry-only`. An export
  the manifest doesn't name stops the sync, as does a manifest entry whose
  collection no longer exists — so adding or renaming a collection in Figma is a
  decision someone makes rather than one the resolver guesses. Within a role,
  two collections landing on the same key throws instead of overwriting.
- `themed` collections are emitted as `--zl-syntax-*` and `--zl-gradient-*` with
  `[data-theme="light"]` overrides, plus Tailwind aliases (`text-zl-syntax-key`,
  `bg-zl-gradient-red-start`). They stay out of `css/shadcn.css`, which owns the
  unprefixed shadcn contract.
- Every collection still feeds the alias registry regardless of role, so
  `{brand.purple.500}` resolves even though `brand` surfaces nothing itself.
