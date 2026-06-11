# ADR 023: ZITADEL Preview Product Bundles

> **Status:** Accepted
> **Date:** 2026-06-11
> **Context:** customer-facing preview releases for nextgen

## Decision

Publish `zitadel-preview` as a product-level bundle release on top of the
independent component release process from
[ADR 002](002-multi-package-release-strategy.md).

`zitadel-preview` uses `0.x.y` semver while the next-generation product is in
preview. A preview release is a GitHub Release named
`ZITADEL Preview <version>` and tagged `zitadel-preview-v<version>`. It contains
a `zitadel-preview-<version>.json` manifest asset with the exact tested
component set:

- the immutable `ghcr.io/zitadel/nextgen:<tag>` server image and digest,
- the exact `@zitadel/cli` npm version,
- the exact SDK package versions needed by the CLI-generated app,
- optional future components such as Helm charts.

The preview workflow composes existing artifacts only. It does not run
GoReleaser, publish npm packages, or change component versions. GoReleaser and
Changesets keep their independent velocity; `zitadel-preview` gives testers one
product release object with release notes and copy-pasteable commands.

The CLI accepts `--preview-manifest <path-or-url>` on `doctor`, `start`, and
`setup`. When present, the manifest pins the local runtime image and scaffolded
SDK dependency versions. `--image` remains the explicit override for
`zitadel start`.

## Consequences

Positive:

- Testers receive one coherent release note and version number.
- Support can reproduce reports from a single manifest.
- Component release velocity stays independent.
- The manifest can later grow to include Helm charts without changing the
  release mental model.

Trade-offs:

- Maintainers must run a final composition workflow after npm and server
  artifacts exist.
- Release notes now exist at both component and product-bundle levels.
- Private GitHub Release assets may need to be copied to a public URL before
  sharing with external testers.

## Follow-up

- Decide when `zitadel-preview@0.x` maps to the eventual `zitadel@5.x` product
  release line.
- Add Helm chart components to the manifest once chart publishing exists.
- Add signing/provenance for preview manifests when artifact signing is enabled
  for the server and npm packages.
