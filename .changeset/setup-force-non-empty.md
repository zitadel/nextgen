---
"@zitadel/cli": minor
---

`setup` now decides where to scaffold with a plain rule instead of a maintained allowlist. A directory with a detected framework is integrated in place; an empty directory gets a fresh app; a non-empty directory with no framework stops and asks for `--force`. `setup --force` scaffolds a fresh app into a non-empty directory, moving the existing files aside and restoring everything the scaffold does not create. This removes the treadmill of allowlisting each tool's metadata (`.gitignore`, `.zitadel`, `.claude`, …) and lets you install the agent skill into a project directory and then scaffold there with an explicit `--force`.
