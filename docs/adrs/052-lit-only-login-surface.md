# ADR 052: A Lit-only login surface, with the console on shadcn/ui

> **Status:** Accepted — 2026-08-16

## Context

ADR 014 split the design system across two renderers because `apps/console` was
a React app that needed the same visual primitives as the Lit login atoms
without shipping a Lit runtime. ADR 015 then moved the shared look into
`@zitadel/shared-component-styles` so one `.zr-*` rule set painted both.

The console has since been rebuilt on **shadcn/ui**, and the Figma design system
now *is* shadcn/ui — the design-system components document `ui.shadcn.com`, and
`@zitadel/design-tokens` emits the shadcn role set (`--zl-background`,
`--zl-card`, `--zl-primary`, `--zl-muted-foreground`, …) in both themes, bridged
into Tailwind utilities by `css/shadcn.css`. The console gets its primitives
from the registry, installed once into `src/components/ui/`.

That removes the premise ADR 014 rested on. What the pair still cost was real:

- The console consumed exactly three paired components (`Alert`, `Icon`,
  `Pill`) across three files, each with a shadcn equivalent already installed.
- One stylesheet painting into both shadow DOM and flat React DOM produced a
  standing list of cross-renderer hazards — a Lit `:host` supplies
  `box-sizing`, `line-height` and font-smoothing that flat React DOM does not,
  and co-located classes collide in React where separate shadow roots keep them
  apart in Lit. Each needed a documented workaround and a `Parity` story
  asserting `getComputedStyle` agreement.
- Shipping one atom took eleven steps across four packages.

Components are cheap when they come from a registry. Keeping a hand-maintained
React mirror of a Lit atom, so that a shadcn app can avoid a shadcn component,
is not a trade worth its upkeep.

## Decision

**The login surface is Lit-only. The console is shadcn-only. They meet at the
token layer and nowhere else.**

- Delete `packages/ui-react` and `packages/shared-component-styles`.
- Each atom's CSS moves next to it as
  `packages/components/src/atoms/zl-<atom>.css`, one file per atom, still
  imported `?inline` and wrapped by `surfaceStyles()`. The shadow-host rules
  merge into the same file: without a flat-DOM renderer there is nothing for the
  split to protect.
- The console composes shadcn components from `apps/console/src/components/ui/`.
  It does not import login atoms.
- Storybook keeps one story per atom. `Parity` stories, `parity.ts` and
  `pairs.json` go.
- `--zl-*` from `@zitadel/design-tokens` stays the single contract between the
  two surfaces, unchanged.

Duplication between a `<zl-button>` and a shadcn `Button` is accepted. They
serve different runtimes and read the same tokens, which is what keeps them
looking alike.

## Consequences

- The `.zr-*` class names stop being a cross-package public API. They remain the
  atoms' internal class names and the `part`/`exportparts` contract is
  untouched, so tenant styling hooks are unaffected.
- Three cross-renderer hazard classes, the `Parity` story requirement, and the
  `pairs.json` registry cease to exist. Shipping an atom is six steps in one
  package.
- A future React consumer that wants a login atom embeds `<zitadel-login>` or
  the atom itself as a custom element — the same path every other framework
  takes through the SDK wrappers.
- The console's `styles.css` no longer imports a second styling vocabulary.

## Related

- Supersedes [ADR 014](./014-design-tokens-and-ui-react-pairs.md) and
  [ADR 015](./015-shared-component-styles.md).
- [`apps/console/docs/styling.md`](../../apps/console/docs/styling.md)
- [`apps/storybook/AGENTS.md`](../../apps/storybook/AGENTS.md)
- [`packages/design-tokens/MIGRATION.md`](../../packages/design-tokens/MIGRATION.md)
