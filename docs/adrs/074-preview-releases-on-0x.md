# ADR 074: Preview Releases on 0.x

> **Status:** Accepted
> **Date:** 2026-10-21
> **Context:** Releases publish as `1.0.0-alpha.N` under npm's `alpha` tag.
> Every install command needs `@alpha`, and npm's `latest` points at a
> placeholder build.
> **Relates to:** [ADR 002](002-multi-package-release-strategy.md) (Changesets
> owns versions; this settles its prerelease follow-up)
> **Implementation:** ships with this ADR; the one-time tag, image and npm
> steps are in the
> [release runbook](../runbooks/manual-release.md#renumbering-the-100-alpha-releases).

## Decision

1. **Leave prerelease mode at `0.1.0`.** `.changeset/pre.json` is deleted and
   the public packages are set to `0.1.0-alpha.28`, so the next version PR
   releases `0.1.0` to npm's `latest` tag, and the container's `:latest` moves
   only with releases. The READMEs say the product is a preview; the version
   string no longer does. Docs, skills and hints run the CLI as
   `npx @zitadel/cli@latest`.
2. **A breaking change is a `minor` until 1.0.0.** Its changeset says what
   breaks and what to do in a paragraph that starts with `**Breaking:**`, as
   breaking minors already did, and the website changelog lists majors and
   such changes under Breaking. Fixes stay `patch`, features `minor`.
   `scripts/check-changesets-status.mjs --pending` refuses a `major` changeset
   while the public packages are below 1.0.0, and CI runs it on every pull
   request.
3. **1.0.0 is GA, cut the Changesets way.** The pull request that starts GA
   deletes the guard and adds a `major` changeset, and Changesets releases
   `1.0.0`. Release candidates, if wanted, run in prerelease mode
   (`changeset pre enter rc`) on a release branch, for that phase only. From
   then on `major` means a new major.
4. **The CLI pins its own version on every release.** The packages `setup`
   adds, the commands the CLI suggests and the image its Docker runtime starts
   use the CLI's exact version, as they did on alpha versions. Other
   prereleases keep their dist-tag.
5. **The 1.0.0-alpha releases are renamed where they can be.**
   - The git tags and GitHub Releases `v1.0.0-alpha.20` to `.28` become
     `v0.1.0-alpha.N`, what they would have been without the major bump. Each
     release names its npm version.
   - The images keep their `1.0.0-alpha.N` tags and gain `0.1.0-alpha.N`: a
     CLI of those versions starts the image of its own version.
   - npm keeps `1.0.0-alpha.N`, deprecated. npm cannot rename or reuse a
     version, its unpublish rules block ours (they depend on each other and
     have several maintainers), and apps scaffolded on those versions pin
     them. `alpha` moves to `0.1.0`, so old `@alpha` commands keep working.
   - `CHANGELOG.md` keeps npm's `1.0.0-alpha.N` headings.
6. **The released changesets go with `pre.json`.** Without the prerelease
   state, Changesets counts every file left in `.changeset/` as pending: the
   ones the alpha releases shipped would repeat in the `0.1.0` notes (about
   370 server entries), and the three released majors would make it `1.0.0`.
7. **Stock Changesets 3, without prerelease bookkeeping.** The repo moves to
   `@changesets/cli` 3 and `@changesets/changelog-github` 1, which write the
   same changelog lines. In v3 a peer dependent's bump is a `patch`, not a
   `major`, so a `0.x` minor no longer pushes dependents to `1.0.0`. The
   release code built for prerelease mode on `main` goes: the `pre.json`
   bookkeeping, which outside it refuses every publish and recovery while a
   changeset is pending, and the check for packages with only `alpha`
   versions on npm. `scripts/release-npm-preflight.mjs` keeps the check for
   packages npm has never seen, and CI still makes a version PR land on its
   own.

## Context

A `major` changeset (removing `GET /users`) moved the fixed group from
`0.1.0-alpha.19` to `1.0.0-alpha.20`. Changesets bumps by the type it is given,
with no 0.x rule and no setting for one, and the fixed group gives all 24
public packages the highest bump of any of them. alpha.23 carried a major too,
and the next release does.

`changeset pre exit` alone would publish `1.0.0`, a stability promise the
preview cannot keep: at that rate a stable line would ship a new major of
every package every few weeks.

npm's `latest` holds the placeholders trusted publishing needed (`0.0.0`,
`0.0.0-bootstrap.0`, `0.0.0-oidc-bootstrap.0`), so a bare
`npx @zitadel/cli` runs a dead build.

## Consequences

Positive:

- `@latest` and plain installs get the current release; `@alpha` leaves the
  docs, skills and hints.
- `^0.1.0` takes only patches, so a caret range never pulls in a breaking
  change.
- The tags, the releases and the website changelog, which sorts releases by
  version, read in order.
- Releasing is stock Changesets: add a changeset, merge the version PR. The
  one rule of our own is the `major` guard.

Trade-offs:

- npm still lists `1.0.0-alpha.28` as its highest version, so tools that
  compare versions (Renovate, Dependabot) offer an app on `1.0.0-alpha.N` no
  move to 0.x. The deprecation message says what to install.
- Links to `/releases/tag/v1.0.0-alpha.N` stop working.
- `@alpha` stays on `0.1.0`.
- The bump type no longer marks a breaking change; the `**Breaking:**`
  paragraph does.

## Alternatives considered

- **Exit at 1.0.0.** A new major every few weeks, or breaking changes in
  minors that break caret ranges.
- **Exit with `changeset pre exit`.** Releases the same versions, but
  Changesets 3 rewrites an exit-mode `pre.json` on every `changeset status`,
  and the GitHub Changesets actions still read the old format.
- **Stay on Changesets 2.** Keeps a peer dependent's `major` bump, which on
  `0.x` turns a minor into `1.0.0`, and the prerelease bookkeeping.
- **Stay in prerelease mode and point `latest` at the alpha.** Fixes bare
  `npx`, but keeps prerelease ranges, which dependency bots handle poorly, and
  `@alpha` in every doc.
- **Keep the 1.x tags.** Consistent with npm, but the website changelog would
  list `0.1.0` under the alphas, and the tag list reads backwards.
- **Rewrite `major` to `minor` in the release job.** Keeps what the author
  wrote in the file, but `changeset status` would still promise `1.0.0`, and
  the pipeline would change the bump behind the author's back.
- **Unpublish the 1.0.0-alpha versions.** npm refuses after 72 hours, and it
  would break installs of the apps pinned to them.
