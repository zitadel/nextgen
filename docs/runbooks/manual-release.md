# Release Runbook

This repo uses Moon for CI/build orchestration, server artifacts, containers,
and the draft GitHub Release shell for `v<version>`. Changesets owns package
versioning and changelogs. Release automation publishes the prebuilt npm
tarballs from the build job (tarball promotion — nothing is rebuilt at publish
time), pushes Changesets git tags, and pushes container images. Product
release prose is written manually by maintainers.

The `release-publish` workflow runs two jobs: `build` compiles every release
artifact without publish credentials and uploads them; `publish` downloads
that artifact, verifies checksums, and promotes each surface (npm, git tags,
container, GitHub Release) behind a gate that records its decision in
`dist/release/publish-plan.json`.

## Normal release

1. Make sure every change that ships in the release has a `.changeset/*.md`,
   including shipped Go server changes (list `@zitadel/server`); see the
   [changeset decision table](../../.changeset/README.md#decision-table).
2. Merge those changes to `main`.
3. `release-publish` runs the Changesets action and opens or updates the
   generated version PR.
4. Review the generated version PR. It should update package versions,
   changelogs, and the `@zitadel/server` npm runtime version.
5. Merge the version PR only after CI is green.
6. `release-publish` runs automatically from that merge commit on `main`:
   the build job produces all artifacts, and the publish job promotes the
   prebuilt npm tarballs to npmjs, pushes Changesets git tags, and pushes the
   `ghcr.io/zitadel/nextgen:<version>` container image. It also creates or
   updates the draft GitHub Release for `v<version>` with generated artifact and
   package facts.
7. If a product announcement is needed, add the human-written product notes to
   the draft GitHub Release and publish it.

## Manual controls

A manual `release-publish` dispatch is an **idempotent re-run** for the
version checked out on `main`: every surface checks what already exists and
skips it (npm publishes only missing package versions, the container push is
skipped when `ghcr.io/zitadel/nextgen:<version>` exists, git tags converge,
the draft GitHub Release is upserted). A re-run after a fully successful
publish is a green no-op — the logs state per surface what was skipped.

- `dry_run=true` (default checkbox) builds and verifies everything and
  reports per surface what a real run would do — including whether the
  container image already exists. It also smokes the compose deployment.
- `dry_run=false` publishes whatever is still missing.
- Remaining gates for manual runs: the workflow runs from `main`, the
  checked-out version is valid semver, and no pending release changesets are
  unrecorded in `.changeset/pre.json`.
- Verify npm packages and `ghcr.io/zitadel/nextgen:<version>` after publish.

## Recover

Recovery is not a separate mode: dispatch `release-publish` again.

```sh
gh workflow run release-publish.yml --repo zitadel/nextgen --ref main -f dry_run=true
# read the per-surface summary in the run logs, then:
gh workflow run release-publish.yml --repo zitadel/nextgen --ref main -f dry_run=false
```

The run rebuilds artifacts in the build job and promotes only the missing
surfaces. This is safe at any time — even when npm is complete and only the
container or the GitHub Release needs repair.

If a *published* container image is corrupt, delete the
`ghcr.io/zitadel/nextgen:<version>` tag in the GHCR package settings first;
the next manual run detects the missing manifest and pushes a fresh build.
Version tags are otherwise immutable — publish never overwrites an existing
image.

After the run, verify the public surfaces and draft release shell:

```sh
npm view @zitadel/server@0.1.0-alpha.14 version
npm view @zitadel/sdk-angular@0.1.0-alpha.14 version
docker buildx imagetools inspect ghcr.io/zitadel/nextgen:0.1.0-alpha.14
gh release view v0.1.0-alpha.14 --repo zitadel/nextgen
```

## Product notes

Product release prose is manual. Use the draft GitHub Release's generated facts
block, the generated Changesets changelogs,
`dist/release/<version>/artifact-summary.md`, and the merged product PRs as
inputs. Publish the draft GitHub Release only when the product needs an
announcement.

## Local checks

```sh
moon ci
moon run release:build     # all release artifacts except container images
moon run release:snapshot  # release:build plus a loaded host-platform image

# Gate-free rehearsal of the publish path (what PR CI runs; works anywhere):
moon run release:rehearse
moon run release:rehearse -- --npm-rehearsal  # also publish to a local Verdaccio

# Publish dry runs promote the artifacts release:build produced:
ZITADEL_RELEASE_DRY_RUN=1 moon run release:publish  # from a generated version commit
# Manual-mode dry run (requires main, like the dispatched workflow):
ZITADEL_RELEASE_DRY_RUN=1 ZITADEL_RELEASE_MANUAL=1 moon run release:publish
```
