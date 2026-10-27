import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchRelease,
  fetchReleases,
  type GitHubRelease,
  parseRelease,
  parseReleases,
  RELEASE_COUNT,
} from "./releases";

// One change as @changesets/changelog-github writes it into each package's
// CHANGELOG.md, after the item's `- `.
const SESSION_CHANGE = `[#2076](https://github.com/zitadel/nextgen/pull/2076) [\`12b3226\`](https://github.com/zitadel/nextgen/commit/12b3226ca941e51534d834c23eea01a872153d9f) Thanks [@fforootd](https://github.com/fforootd)! - The server SDKs now count a session as signed in only when it belongs to the
  app's own project.

  The project comes from the new \`projectId\` middleware option.`;

const TYPO_CHANGE =
  "[#2201](https://github.com/zitadel/nextgen/pull/2201) Thanks [@livio-a](https://github.com/livio-a)! - Fixes a typo in the `zitadel.yaml` schema.";

// A body as scripts/release-github.mjs writes it, after GitHub's API has
// turned its line ends into CRLF: each change once, after its packages, and
// the line that stands in for the changes that did not fit.
const BODY =
  `<!-- Maintainers: add human-written product release notes above the generated facts before publishing this draft. -->

<!-- nextgen-release-facts:start -->
## Generated Release Facts

This section is maintained by release automation. Edit product notes outside this block.

Release commit: \`5983d4b581e6\`

### Container Images

| Image | Reference |
|---|---|
| container | \`ghcr.io/zitadel/nextgen:0.2.0\` |

### npm Packages

| Package | Version |
|---|---|
| \`@zitadel/cli\` | \`0.2.0\` |
| \`@zitadel/server\` | \`0.2.0\` |
| \`@zitadel/config\` | \`0.2.0\` |
| \`@zitadel/api\` | \`0.2.0\` |

### Package Changes

#### Minor Changes

- \`@zitadel/cli\`: [#2157](https://github.com/zitadel/nextgen/pull/2157) [\`adf6453\`](https://github.com/zitadel/nextgen/commit/adf64530b8a647465ae80888fb52232d05107809) Thanks [@fforootd](https://github.com/fforootd)! - \`zitadel setup --dev-port <port>\` now moves an app that's already set up to another port.

- \`@zitadel/cli\`, \`@zitadel/server\`: ${SESSION_CHANGE}

- \`@zitadel/server\`: [#1386](https://github.com/zitadel/nextgen/pull/1386) [\`6821cc6\`](https://github.com/zitadel/nextgen/commit/6821cc62356ef75cce936907d2a0bdb7ff1a5d5e) Thanks [@peintnermax](https://github.com/peintnermax), [@fforootd](https://github.com/fforootd)! - \`POST /flows/{flow_id}\` with \`{action: "sso",
  sso_provider_id}\` on a step that offers \`sso_providers\`
  pins the connection at its newest revision.

  - \`@zitadel/sdk-core\`: \`NextgenSession\` becomes \`{userId,
  identifier}\`.

#### Patch Changes

- \`@zitadel/config\`: ${TYPO_CHANGE}

_1 patch change omitted to keep this release body under GitHub's 125000-character limit; see \`packages/api/CHANGELOG.md\` at tag \`v0.2.0\`._
<!-- nextgen-release-facts:end -->`.replace(/\n/g, "\r\n");

// The same changes as scripts/release-github.mjs wrote them up to 0.1.0, each
// package's CHANGELOG.md section in turn: rewrapped where a formatter wrapped
// one, and a pointer where a package's section did not fit.
const PER_PACKAGE_BODY = `<!-- nextgen-release-facts:start -->
### Package Changes

#### \`@zitadel/cli\`

### Minor Changes

- [#2157](https://github.com/zitadel/nextgen/pull/2157) [\`adf6453\`](https://github.com/zitadel/nextgen/commit/adf64530b8a647465ae80888fb52232d05107809) Thanks [@fforootd](https://github.com/fforootd)! - \`zitadel setup --dev-port <port>\` now moves an app that's already set up to another port.

### Patch Changes

- ${SESSION_CHANGE}

#### \`@zitadel/server\`

### Minor Changes

- ${SESSION_CHANGE}

- [#1386](https://github.com/zitadel/nextgen/pull/1386) [\`6821cc6\`](https://github.com/zitadel/nextgen/commit/6821cc62356ef75cce936907d2a0bdb7ff1a5d5e) Thanks [@peintnermax](https://github.com/peintnermax), [@fforootd](https://github.com/fforootd)! - \`POST /flows/{flow_id}\` with \`{action: "sso",
sso_provider_id}\` on a step that offers \`sso_providers\`
  pins the connection at its newest revision.

  - \`@zitadel/sdk-core\`: \`NextgenSession\` becomes \`{userId,
identifier}\`.

#### \`@zitadel/config\`

### Patch Changes

- ${TYPO_CHANGE}

#### \`@zitadel/api\`

_Changelog omitted to keep this release body under GitHub's 125000-character limit; see \`packages/api/CHANGELOG.md\` at tag \`v0.1.0\`._
<!-- nextgen-release-facts:end -->`.replace(/\n/g, "\r\n");

function release(tag: string, fields: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: tag,
    html_url: `https://github.com/zitadel/nextgen/releases/tag/${tag}`,
    published_at: "2026-10-20T20:15:04Z",
    draft: false,
    body: "",
    ...fields,
  };
}

describe("parseRelease", () => {
  it("reads each change with the packages it changes and its bump", () => {
    const { changes } = parseRelease(release("v0.2.0", { body: BODY }));

    expect(changes.map(({ source, bump, packages }) => ({ source, bump, packages }))).toEqual([
      {
        source: { label: "#2157", href: "https://github.com/zitadel/nextgen/pull/2157" },
        bump: "minor",
        packages: ["@zitadel/cli"],
      },
      {
        source: { label: "#2076", href: "https://github.com/zitadel/nextgen/pull/2076" },
        bump: "minor",
        packages: ["@zitadel/cli", "@zitadel/server"],
      },
      {
        source: { label: "#1386", href: "https://github.com/zitadel/nextgen/pull/1386" },
        bump: "minor",
        packages: ["@zitadel/server"],
      },
      {
        source: { label: "#2201", href: "https://github.com/zitadel/nextgen/pull/2201" },
        bump: "patch",
        packages: ["@zitadel/config"],
      },
    ]);
  });

  it("keeps a change's summary as Markdown, without its packages, what precedes it or the list's indent", () => {
    const [, session, sso] = parseRelease(release("v0.2.0", { body: BODY })).changes;

    expect(session?.summary).toBe(
      "The server SDKs now count a session as signed in only when it belongs to the\napp's own project.\n\nThe project comes from the new `projectId` middleware option.",
    );
    expect(session?.authors).toEqual([{ label: "@fforootd", href: "https://github.com/fforootd" }]);
    expect(sso?.summary).toBe(
      '`POST /flows/{flow_id}` with `{action: "sso",\nsso_provider_id}` on a step that offers `sso_providers`\npins the connection at its newest revision.\n\n- `@zitadel/sdk-core`: `NextgenSession` becomes `{userId,\nidentifier}`.',
    );
    expect(sso?.authors.map(({ label }) => label)).toEqual(["@peintnermax", "@fforootd"]);
  });

  it("keeps the line that stands in for the changes that did not fit, and no placeholder as notes", () => {
    const parsed = parseRelease(release("v0.2.0", { body: BODY }));

    expect(parsed.notices).toEqual([
      {
        text: "_1 patch change omitted to keep this release body under GitHub's 125000-character limit; see `packages/api/CHANGELOG.md` at tag `v0.2.0`._",
      },
    ]);
    expect(parsed.notes).toBe("");
  });

  it("reads a body that repeats each package's changes, up to 0.1.0, into the same changes", () => {
    const parsed = parseRelease(release("v0.1.0", { body: PER_PACKAGE_BODY }));

    // Each change once, with each of its packages and its highest bump; a
    // rewrapped line continues its paragraph, as Markdown reads it.
    expect(parsed.changes).toEqual(parseRelease(release("v0.2.0", { body: BODY })).changes);
    expect(parsed.notices).toEqual([
      {
        package: "@zitadel/api",
        text: "_Changelog omitted to keep this release body under GitHub's 125000-character limit; see `packages/api/CHANGELOG.md` at tag `v0.1.0`._",
      },
    ]);
  });

  it("reads the maintainers' notes on both sides of the generated block, without the placeholder", () => {
    const body = [
      "## Highlights",
      "",
      "Sign in with Google.",
      "",
      "<!-- Maintainers: add human-written product release notes above the generated facts before publishing this draft. -->",
      "",
      "<!-- nextgen-release-facts:start -->",
      "### Package Changes",
      "",
      "_No package-specific changelog entries beyond version or dependency updates._",
      "<!-- nextgen-release-facts:end -->",
      "",
      "Thanks to everyone who tried the preview.",
    ].join("\r\n");

    expect(parseRelease(release("v1.0.0-alpha.29", { body }))).toMatchObject({
      notes: "## Highlights\n\nSign in with Google.\n\nThanks to everyone who tried the preview.",
      changes: [],
      notices: [
        { text: "_No package-specific changelog entries beyond version or dependency updates._" },
      ],
    });
  });

  it("takes a body without the generated block as notes", () => {
    expect(parseRelease(release("v1.0.0-alpha.29", { body: "Fixes the login." }))).toMatchObject({
      notes: "Fixes the login.",
      changes: [],
      notices: [],
    });
  });

  it("links a change's commit when it has no pull request, and reads one without either", () => {
    const body = [
      "<!-- nextgen-release-facts:start -->",
      "### Package Changes",
      "",
      "#### Major Changes",
      "",
      "- `@zitadel/cli`: [`abc1234`](https://github.com/zitadel/nextgen/commit/abc1234) Thanks [@livio-a](https://github.com/livio-a)! - Drops the old flag.",
      "- `@zitadel/cli`, `@zitadel/server`: `zitadel help`: Updates the help text.",
      "<!-- nextgen-release-facts:end -->",
    ].join("\n");

    expect(parseRelease(release("v1.0.0", { body })).changes).toEqual([
      {
        summary: "Drops the old flag.",
        bump: "major",
        markedBreaking: false,
        packages: ["@zitadel/cli"],
        source: { label: "abc1234", href: "https://github.com/zitadel/nextgen/commit/abc1234" },
        authors: [{ label: "@livio-a", href: "https://github.com/livio-a" }],
      },
      {
        summary: "`zitadel help`: Updates the help text.",
        bump: "major",
        markedBreaking: false,
        packages: ["@zitadel/cli", "@zitadel/server"],
        authors: [],
      },
    ]);
  });

  it("marks a change with a paragraph that starts with **Breaking:**, first or later", () => {
    const body = [
      "<!-- nextgen-release-facts:start -->",
      "### Package Changes",
      "",
      "#### Minor Changes",
      "",
      "- `@zitadel/server`: [#2175](https://github.com/zitadel/nextgen/pull/2175) Thanks [@fforootd](https://github.com/fforootd)! - **Breaking:** Drops the old flag.",
      "- `@zitadel/server`: Signing out now needs the CSRF token.",
      "",
      "  **Breaking:** an older `@zitadel/components` cannot sign out.",
      "",
      "- `@zitadel/server`: Adds a flag; nothing here is **Breaking:** in the middle of a sentence.",
      "<!-- nextgen-release-facts:end -->",
    ].join("\n");

    expect(
      parseRelease(release("v0.2.0", { body })).changes.map(({ summary, markedBreaking }) => ({
        summary,
        markedBreaking,
      })),
    ).toEqual([
      { summary: "**Breaking:** Drops the old flag.", markedBreaking: true },
      {
        summary:
          "Signing out now needs the CSRF token.\n\n**Breaking:** an older `@zitadel/components` cannot sign out.",
        markedBreaking: true,
      },
      {
        summary: "Adds a flag; nothing here is **Breaking:** in the middle of a sentence.",
        markedBreaking: false,
      },
    ]);
  });
});

describe("parseReleases", () => {
  it("leaves drafts out and puts the highest version first", () => {
    const releases = parseReleases([
      release("v1.0.0-alpha.9"),
      release("nightly"),
      release("v1.0.0"),
      release("v1.0.0-alpha.11", { draft: true, published_at: null }),
      release("v1.0.0-alpha.10"),
    ]);

    expect(releases.map(({ tag }) => tag)).toEqual([
      "v1.0.0",
      "v1.0.0-alpha.10",
      "v1.0.0-alpha.9",
      "nightly",
    ]);
  });

  it("starts at 0.1.0, leaving the alpha previews before it to GitHub", () => {
    const releases = parseReleases([
      release("v0.1.0-alpha.28"),
      release("v0.1.1"),
      release("v0.1.0"),
      release("v0.1.0-alpha.9"),
    ]);

    expect(releases.map(({ tag }) => tag)).toEqual(["v0.1.1", "v0.1.0"]);
  });

  it("refuses an answer that is no list of releases", () => {
    expect(() => parseReleases({ message: "API rate limit exceeded" })).toThrow(
      "not a list of releases",
    );
  });
});

describe("fetchReleases", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks GitHub for the newest releases with the token, when there is one", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([release("v1.0.0-alpha.28")]),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchReleases("test-token")).resolves.toMatchObject([{ tag: "v1.0.0-alpha.28" }]);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.github.com/repos/zitadel/nextgen/releases?per_page=${RELEASE_COUNT}`,
      {
        // Never Next's data cache: a later build would read it back.
        cache: "no-store",
        headers: expect.objectContaining({ authorization: "Bearer test-token" }),
      },
    );
  });

  it("throws when GitHub refuses, so a regeneration keeps the page served last", async () => {
    vi.stubEnv("WEBSITE_GITHUB_TOKEN", "");
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("rate limited", { status: 403, statusText: "Forbidden" }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchReleases()).rejects.toThrow("403 Forbidden");
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({ authorization: expect.anything() }),
      }),
    );
  });
});

describe("fetchRelease", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the release a tag names, for its own page", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(release("v0.2.0", { body: "Highlights." })),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchRelease("v0.2.0", "test-token")).resolves.toMatchObject({
      tag: "v0.2.0",
      notes: "Highlights.",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/zitadel/nextgen/releases/tags/v0.2.0",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reads none for a tag GitHub has no release by, and throws when GitHub refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
        .mockResolvedValueOnce(
          new Response("rate limited", { status: 403, statusText: "Forbidden" }),
        ),
    );

    await expect(fetchRelease("v9.9.9")).resolves.toBeUndefined();
    await expect(fetchRelease("v0.2.0")).rejects.toThrow("403 Forbidden");
  });

  it("reads none, without asking GitHub, for an alpha preview or a tag that is no version", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);

    for (const tag of ["v0.1.0-alpha.28", "nightly", "feed.xml"]) {
      await expect(fetchRelease(tag)).resolves.toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
