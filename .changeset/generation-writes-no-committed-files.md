---
---

The public packages' build scripts change, not what they ship: the CLI writes its oclif manifest in `build` instead of `prepack`, the CLI and config drop lifecycle hooks that repeated turbo tasks, their generation scripts drop the `generated-sources` lock, and the design tokens' generator gains a read-only `--check`.
