# Release Runbook

This is the operator checklist for cutting a ZITADEL Preview release. ADR 002
explains why the repository uses Changesets for npm packages and GoReleaser for
server artifacts; this page explains the order to run the release.

## Release Model

A ZITADEL Preview release is one tested bundle:

- Git tag: `vX.Y.Z-alpha.N`
- npm package versions: `X.Y.Z-alpha.N`
- npm handout: `@zitadel/cli@preview`
- Server image: `ghcr.io/zitadel/zitadel-preview:X.Y.Z-alpha.N`
- Moving preview image: `ghcr.io/zitadel/zitadel-preview:preview`
- GitHub Release title: `ZITADEL Preview X.Y.Z-alpha.N`
- Archive names: `zitadel-preview_X.Y.Z-alpha.N_<os>_<arch>`

The public npm packages stay fixed together during the MVP preview phase. The
CLI uses its own package version to choose the matching immutable server image
unless `--image` or `ZITADEL_LOCAL_IMAGE` overrides it.

## Prerequisites

Before releasing, confirm:

- You can merge to `main` and run manual GitHub Actions workflows.
- The workflow can publish packages to GHCR.
- npm trusted publishing is configured for every public package listed in
  [.changeset/README.md](../../.changeset/README.md).
- All release-bound PRs are merged and `main` is green.
- Pending changesets are merged through the "Version Packages" PR.
- You have `git`, `gh`, `node`, and `corepack pnpm` available locally.

## One-Time Maintenance

The public package names already exist on npm. If a future release adds another
public package, create that package on npm and configure trusted publishing for
`release-npm.yml` before adding it to the release bundle.

Clean up old package-level GitHub Releases once, without deleting git tags, if
any `@zitadel/*` GitHub Release entries still exist:

```sh
node scripts/delete-package-github-releases.mjs
node scripts/delete-package-github-releases.mjs --execute
```

The first command is a dry run. Review its output before running with
`--execute`.

## Preview Release Checklist

Set the release version once and reuse it in every command:

```sh
VERSION=X.Y.Z-alpha.N
TAG=v$VERSION
```

1. Confirm `main` is green and contains every release-bound PR.

2. Confirm the pending package release before the Version Packages PR merges:

   ```sh
   git switch main
   git pull --ff-only
   corepack pnpm changeset status --verbose
   ```

   The public packages should all resolve to `$VERSION`.

3. Merge the "Version Packages" PR and confirm the npm publishing workflow
   succeeded.

4. Verify the npm `preview` channel:

   ```sh
   npm view @zitadel/cli@preview version
   npm view @zitadel/api@preview version
   npm view @zitadel/components@preview version
   npm view @zitadel/sdk-core@preview version
   npm view @zitadel/sdk-next@preview version
   npm view @zitadel/sdk-nuxt@preview version
   npm view @zitadel/sdk-react@preview version
   npm view @zitadel/sdk-vue@preview version
   npm view @zitadel/sdk-angular@preview version
   ```

   Every command must print `$VERSION`.

5. Tag the commit produced by the merged Version Packages PR:

   ```sh
   git switch main
   git pull --ff-only
   git tag "$TAG"
   git push origin "$TAG"
   ```

   If you are tagging an older commit intentionally, use
   `git tag "$TAG" <commit>` instead. Do not move a public release tag after it
   has been pushed.

6. Run the GitHub Actions `release` workflow from `main`:

   - Workflow: `.github/workflows/release.yml`
   - `ref`: `$TAG`
   - `snapshot`: `false`

   The workflow's `Verify preview bundle versions` step must pass before
   GoReleaser publishes any product artifacts.

7. Verify the draft GitHub Release:

   - Title is `ZITADEL Preview $VERSION`.
   - Assets are named `zitadel-preview_${VERSION}_<os>_<arch>`.
   - The release is still a draft until the checks below pass.

8. Verify GHCR image tags:

   ```sh
   docker buildx imagetools inspect "ghcr.io/zitadel/zitadel-preview:$VERSION"
   docker buildx imagetools inspect "ghcr.io/zitadel/zitadel-preview:preview"
   ```

9. Verify the released fresh-app flow:

   ```sh
   corepack pnpm run journey -- --backend image --image "ghcr.io/zitadel/zitadel-preview:$VERSION"
   ```

10. Publish the draft GitHub Release after npm, GHCR, release assets, and the
    released-image journey all verify.

## Failure Handling

- Rerun the workflow for transient GitHub Actions, GoReleaser, or GHCR failures
  when no public artifact was published incorrectly.
- If npm packages, images, or release assets are already public and need a fix,
  merge a fix and cut the next preview version (`alpha.N+1`).
- Never force-move or rewrite a public release tag.
- Keep failed draft GitHub Releases as drafts until the team decides whether to
  delete or supersede them.
- Keep Docker `latest` out of prerelease handouts. Use immutable version tags or
  the moving `preview` tag.

## Stable Releases

Stable releases are future-mode for this repository. When the team is ready to
leave the alpha prerelease line, start by exiting Changesets prerelease mode:

```sh
corepack pnpm changeset pre exit
corepack pnpm changeset version
```

Document the stable release checklist before publishing `latest`.
