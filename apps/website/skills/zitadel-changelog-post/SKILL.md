---
name: zitadel-changelog-post
description: >-
  Draft the post that leads a Zitadel NextGen release on the preview's
  changelog (preview.zitadel.com/changelog): apps/website/changelog/<version>.md
  in the zitadel/nextgen repository, written from the release's changes and
  opened as a pull request. Use after a release when asked to write, draft or
  update a changelog post or a release's story.
metadata:
  internal: true
---

# Changelog post

A release's post is the story above its changes on the changelog. The page
lists every change by itself, from the packages' `CHANGELOG.md`; the post says
what the release means for someone using the preview, and what they must do.

`metadata.internal` keeps this skill out of `npx skills add zitadel/nextgen`,
which installs the users' skills.

## Gather

1. The version, such as `0.2.0`; ask when it is not given. Its version PR must
   have merged: `apps/cli/CHANGELOG.md` has a `## 0.2.0` section, and the build
   refuses a post for a version no `CHANGELOG.md` has.
2. The day it shipped:
   `git log -1 --format=%cs -S'## 0.2.0' -- apps/cli/CHANGELOG.md`.
3. Its changes, each once with the packages it changes: the GitHub Release,
   `gh release view v0.2.0 --repo zitadel/nextgen --json body -q .body`, or the
   `## 0.2.0` sections of the packages' `CHANGELOG.md`. A breaking change has a
   paragraph that starts with `**Breaking:**`.
4. For each change worth telling, its pull request (`gh pr view <number>`) and
   the docs page that covers it (`apps/docs/content/docs/`).
5. The earlier posts in `apps/website/changelog/`, for structure and tone.

## Write

`apps/website/changelog/<version>.md`:

```md
---
date: 2026-10-28
---

What the release is about, for someone who uses the preview, in a paragraph or two.

### What's new

- **What a user can do now.** A sentence or two. [Docs page](https://preview.zitadel.com/docs/…)

### Upgrading from 0.1.0

- What to do about each breaking change, or anything else a user must act on, with its pull request.
```

- The front matter holds only `date`; the build fails on anything else.
- Tell the three to seven changes a user notices most, folding small ones
  together; the list below the post carries the rest.
- The page shows each breaking change in full below the post, so in Upgrading
  say what to do and link the pull request instead of repeating the change.
- Add `### Not there yet` only for gaps a user would run into.
- Write as `.changeset/README.md` asks of a summary: the outcome first, the
  surface a user touches, no internals or ADR numbers.
- Write Markdown only; the website drops HTML. Link pull requests in full,
  `[#123](https://github.com/zitadel/nextgen/pull/123)`, and docs pages as
  `https://preview.zitadel.com/docs/…`.
- Start headings at `###`: the page sets the post under the release's heading.
- Claim nothing the changes, their pull requests or the docs do not say.

## Check and open the pull request

```sh
moon run website:test website:build
moon run website:start   # /changelog and /changelog/v<version> on port 3004
```

Commit only the post, on a branch from `main`, and open a pull request titled
`build(deploy): add the <version> post to the website changelog`, without a
changeset.
