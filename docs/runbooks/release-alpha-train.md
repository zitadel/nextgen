# Alpha Release Train Runbook

Use this when publishing a public nextgen alpha for testers. The train version is
one semver prerelease across npm packages, the CLI, server image, and GoReleaser
artifacts, for example `0.1.0-alpha.7`.

## Steps

1. Merge feature and fix PRs with changesets as usual.
2. Wait for the `release-npm` job in [`ci.yml`](../../.github/workflows/ci.yml)
   to open or update the `chore: version packages` PR.
3. Review that every public `@zitadel/*` package in the fixed group has the same
   `0.1.0-alpha.N` version.
4. Before merging, run the release process check:
   `corepack pnpm run check -- --only release`.
5. Merge the Version Packages PR after CI is green.
6. Let the main-branch `ci.yml` run finish. Its `release-npm` job starts only
   after the aggregate CI gate passes for that exact commit.
7. After CI is green, the `release-npm` job creates `v<version>`, runs
   GoReleaser, publishes `ghcr.io/zitadel/nextgen:<version>`, and updates one
   draft GitHub prerelease named `ZITADEL Alpha <version>`. Alpha trains do not
   move `ghcr.io/zitadel/nextgen:latest`.
8. Review the draft prerelease notes and publish the GitHub Release.

## Local Check

```sh
corepack pnpm run check -- --only release
```

This validates the GoReleaser config, Changesets fixed group, planned lockstep
alpha version, GitHub Release guardrails, release script tests, and a
no-publish/no-docker GoReleaser snapshot.

## Tester Commands

Latest alpha stream:

```sh
npx @zitadel/cli@alpha doctor
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
```

Exact reproducible train:

```sh
npx @zitadel/cli@0.1.0-alpha.N doctor
npx @zitadel/cli@0.1.0-alpha.N start
npx @zitadel/cli@0.1.0-alpha.N setup --server local
```

For `@zitadel/cli@0.1.0-alpha.N`, the CLI starts
`ghcr.io/zitadel/nextgen:0.1.0-alpha.N` by default. Use `--image` or
`ZITADEL_LOCAL_IMAGE` only for advanced debugging.

## Failure Checks

- If npm publish fails, do not create the Go tag manually; rerun or fix npm
  publishing first.
- If npm publish succeeds but a later tag, GoReleaser, GHCR, or GitHub Release
  step fails, rerun the same workflow for the same commit. It reuses a matching
  `v<version>` tag and completes only the missing release side.
- If the alpha preparation step fails, check for mismatched public package
  versions, a missing Changesets fixed group entry, or an existing `v<version>`
  tag.
- If GoReleaser fails after the tag was pushed, do not cut a different npm
  version. Fix the release issue, run the manual `release.yml` fallback with
  `ref: v<version>` and `snapshot: false`, then update the draft release notes
  for that same tag if needed.
