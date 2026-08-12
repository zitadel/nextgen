# Release Runbook

This repo uses Moon for CI/build orchestration, server artifacts, containers,
and the draft GitHub Release shell for `v<version>`. Changesets owns package
versioning, changelogs, npm publishing, and public package tags. Product release
prose is written manually by maintainers.

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
6. `release-publish` runs automatically from that merge commit on `main`,
   publishes npm packages with Changesets, and pushes the
   `ghcr.io/zitadel/nextgen:<version>` container image. It also creates or
   updates the draft GitHub Release for `v<version>` with generated artifact and
   package facts.
7. If a product announcement is needed, add the human-written product notes to
   the draft GitHub Release and publish it.

## Manual controls

- GitHub renders the `dry_run` workflow input as a checkbox: checked means no
  remote mutations; unchecked allows publishing when the normal or recovery
  gates pass.
- Run `release-publish` manually with `dry_run=true` to build and verify
  server archives, checksums, npm tarballs, Docker metadata, and the generated
  GitHub Release facts block without publishing.
- Run `release-publish` manually with `dry_run=false` only when the current
  `main` commit is still the generated `build: version packages` commit.
- Run `release-publish` manually with `recover_version=<version>` when `main`
  has moved past the generated version commit or any publish-side artifact may
  be missing. Use `dry_run=true` first, then `dry_run=false`.
- Verify npm packages and `ghcr.io/zitadel/nextgen:<version>` after publish.

## Recover

### Pick the mode

| Situation | Workflow | Inputs |
| --- | --- | --- |
| `main` is still on the generated version commit and the first publish failed before finishing | `release-publish` | `dry_run=true`, then `dry_run=false` |
| `main` has moved past the generated version commit, or the missing artifact surface is unclear | `release-publish` | `recover_version=<version>` with `dry_run=true`, then `dry_run=false` |

Use `release-publish` with `recover_version=<version>` for an already-versioned
release when any publish-side artifact may be missing. This is the single
recovery path. It verifies the checked-out `@zitadel/server` version, rebuilds
release artifacts, runs Changesets publish, pushes containers, and updates the
draft GitHub Release facts block.
`changeset publish` only publishes package versions that are not already
present on npm, so the same recovery path is safe when npm packages are already
complete and only Docker needs repair.

```sh
gh workflow run release-publish.yml \
  --repo zitadel/nextgen \
  --ref main \
  -f dry_run=true \
  -f recover_version=0.1.0-alpha.8

gh workflow run release-publish.yml \
  --repo zitadel/nextgen \
  --ref main \
  -f dry_run=false \
  -f recover_version=0.1.0-alpha.8
```

The `recover_version` path deliberately bypasses the normal "latest commit must
be a generated version commit" gate, but it still requires:

- the checked-out `@zitadel/server` version to equal `recover_version`;
- the workflow to run from `main`;
- no unrecorded pending release changesets;
- the normal artifact preflight and snapshot verification to pass.

After the recovery run, verify the public surfaces and draft release shell:

```sh
npm view @zitadel/server@0.1.0-alpha.8 version
npm view @zitadel/sdk-angular@0.1.0-alpha.8 version
docker buildx imagetools inspect ghcr.io/zitadel/nextgen:0.1.0-alpha.8
gh release view v0.1.0-alpha.8 --repo zitadel/nextgen
```

## Product notes

Product release prose is manual. Use the draft GitHub Release's generated facts
block, the generated Changesets changelogs,
`dist/release/<version>/artifact-summary.md`, and the merged product PRs as
inputs. Publish the draft GitHub Release only when the product needs an
announcement.

GitHub rejects release bodies over 125000 characters, so the generated facts
block replaces its largest package changelog sections with pointers to the
per-package `CHANGELOG.md` when the body would not fit. If the human-written
product notes alone push past the limit, the facts update fails loudly instead
of truncating maintainer prose — shorten the notes and rerun.

## Local checks

```sh
moon ci
moon run release:snapshot
moon run release:publish -- --dry-run  # from a generated version commit
moon run release:publish -- --dry-run --recover-version 0.1.0-alpha.8
```
