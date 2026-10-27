import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  assembleReleases,
  type Changelog,
  parsePost,
  type Post,
  readChangelogs,
  readPosts,
  readReleases,
} from "./releases";

// One changeset's entry as @changesets/changelog-github writes it into the
// CHANGELOG.md of every package the changeset lists.
const SESSION_CHANGE = `- [#2076](https://github.com/zitadel/nextgen/pull/2076) [\`12b3226\`](https://github.com/zitadel/nextgen/commit/12b3226ca941e51534d834c23eea01a872153d9f) Thanks [@fforootd](https://github.com/fforootd)! - The server SDKs now count a session as signed in only when it belongs to the
  app's own project.

  The project comes from the new \`projectId\` middleware option.`;

const CLI = `# @zitadel/cli

## 0.2.0

### Minor Changes

- [#2157](https://github.com/zitadel/nextgen/pull/2157) [\`adf6453\`](https://github.com/zitadel/nextgen/commit/adf64530b8a647465ae80888fb52232d05107809) Thanks [@fforootd](https://github.com/fforootd)! - \`zitadel setup --dev-port <port>\` now moves an app that's already set up to another port.

### Patch Changes

${SESSION_CHANGE}
- Updated dependencies [[\`12b3226\`](https://github.com/zitadel/nextgen/commit/12b3226ca941e51534d834c23eea01a872153d9f)]:
  - @zitadel/server@0.2.0

## 0.1.0

### Patch Changes

- Updates the help text.

## 1.0.0-alpha.28

### Patch Changes

- A change in an alpha preview.
`;

const SERVER = `# @zitadel/server

## 0.2.0

### Minor Changes

${SESSION_CHANGE}

- [#1386](https://github.com/zitadel/nextgen/pull/1386) [\`6821cc6\`](https://github.com/zitadel/nextgen/commit/6821cc62356ef75cce936907d2a0bdb7ff1a5d5e) Thanks [@peintnermax](https://github.com/peintnermax), [@fforootd](https://github.com/fforootd)! - \`POST /flows/{flow_id}\` with \`{action: "sso",
sso_provider_id}\` on a step that offers \`sso_providers\`
  pins the connection at its newest revision.

## 0.1.0

No changes in this release.
`;

const CHANGELOGS: Changelog[] = [
  { name: "@zitadel/cli", source: CLI },
  { name: "@zitadel/server", source: SERVER },
];

function changelog(entries: string[], version = "0.2.0", group = "Minor"): Changelog {
  return {
    name: "@zitadel/server",
    source: `# @zitadel/server\n\n## ${version}\n\n### ${group} Changes\n\n${entries.join("\n")}\n`,
  };
}

describe("assembleReleases", () => {
  it("lists a change that ships in several packages once, with each package and its highest bump", () => {
    const [release] = assembleReleases(CHANGELOGS, new Map());

    expect(
      release?.changes.map(({ source, bump, packages }) => ({ source, bump, packages })),
    ).toEqual([
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
    ]);
  });

  it("keeps a change's summary as Markdown, without what precedes it or the list's indent", () => {
    const [, session, sso] = assembleReleases(CHANGELOGS, new Map())[0]?.changes ?? [];

    expect(session?.summary).toBe(
      "The server SDKs now count a session as signed in only when it belongs to the\napp's own project.\n\nThe project comes from the new `projectId` middleware option.",
    );
    expect(session?.authors).toEqual([{ label: "@fforootd", href: "https://github.com/fforootd" }]);
    // The unindented lines continue their paragraphs, as Markdown reads them.
    expect(sso?.summary).toBe(
      '`POST /flows/{flow_id}` with `{action: "sso",\nsso_provider_id}` on a step that offers `sso_providers`\npins the connection at its newest revision.',
    );
    expect(sso?.authors.map(({ label }) => label)).toEqual(["@peintnermax", "@fforootd"]);
  });

  it("starts at 0.1.0, leaves out prereleases and lists the highest version first", () => {
    const releases = assembleReleases(CHANGELOGS, new Map());

    expect(releases.map(({ tag, url }) => ({ tag, url }))).toEqual([
      { tag: "v0.2.0", url: "https://github.com/zitadel/nextgen/releases/tag/v0.2.0" },
      { tag: "v0.1.0", url: "https://github.com/zitadel/nextgen/releases/tag/v0.1.0" },
    ]);
  });

  it("leaves out dependency updates and a package's section without changes", () => {
    const releases = assembleReleases(CHANGELOGS, new Map());

    expect(releases[0]?.changes.some(({ summary }) => summary.includes("Updated"))).toBe(false);
    expect(releases[1]?.changes.map(({ summary, packages }) => ({ summary, packages }))).toEqual([
      { summary: "Updates the help text.", packages: ["@zitadel/cli"] },
    ]);
  });

  it("takes a release's day and story from its post, and has neither without one", () => {
    const posts = new Map<string, Post>([["0.2.0", { date: "2026-10-28", notes: "Highlights." }]]);
    const releases = assembleReleases(CHANGELOGS, posts);

    expect(releases.map(({ date, notes }) => ({ date, notes }))).toEqual([
      { date: "2026-10-28", notes: "Highlights." },
      { date: undefined, notes: "" },
    ]);
  });

  it("refuses a post for a version no changelog has, such as one merged before its release", () => {
    const posts = new Map<string, Post>([["0.3.0", { date: "2026-11-04", notes: "Soon." }]]);

    expect(() => assembleReleases(CHANGELOGS, posts)).toThrow("0.3.0.md");
  });

  it("links a change's commit when it has no pull request, and reads one without either", () => {
    const [release] = assembleReleases(
      [
        changelog(
          [
            "- [`abc1234`](https://github.com/zitadel/nextgen/commit/abc1234) Thanks [@livio-a](https://github.com/livio-a)! - Drops the old flag.",
            "- Updates the help text.",
          ],
          "1.0.0",
          "Major",
        ),
      ],
      new Map(),
    );

    expect(release?.changes).toEqual([
      {
        summary: "Drops the old flag.",
        bump: "major",
        markedBreaking: false,
        packages: ["@zitadel/server"],
        source: { label: "abc1234", href: "https://github.com/zitadel/nextgen/commit/abc1234" },
        authors: [{ label: "@livio-a", href: "https://github.com/livio-a" }],
      },
      {
        summary: "Updates the help text.",
        bump: "major",
        markedBreaking: false,
        packages: ["@zitadel/server"],
        authors: [],
      },
    ]);
  });

  it("marks a change with a paragraph that starts with **Breaking:**, first or later", () => {
    const [release] = assembleReleases(
      [
        changelog([
          "- [#2175](https://github.com/zitadel/nextgen/pull/2175) Thanks [@fforootd](https://github.com/fforootd)! - **Breaking:** Drops the old flag.",
          "- Signing out now needs the CSRF token.",
          "",
          "  **Breaking:** an older `@zitadel/components` cannot sign out.",
          "",
          "- Adds a flag; nothing here is **Breaking:** in the middle of a sentence.",
        ]),
      ],
      new Map(),
    );

    expect(
      release?.changes.map(({ summary, markedBreaking }) => ({ summary, markedBreaking })),
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

describe("parsePost", () => {
  it("reads the day from the front matter and the story after it", () => {
    expect(
      parsePost("0.2.0.md", "---\ndate: 2026-10-28\n---\n\n### What's new\n\nDeploy.\n"),
    ).toEqual({ date: "2026-10-28", notes: "### What's new\n\nDeploy." });
  });

  it.each([
    ["no front matter", "### What's new"],
    ["no date", "---\n---\nDeploy."],
    ["a field it does not know", "---\ndate: 2026-10-28\ntitle: Deploy\n---\nDeploy."],
    ["a day that is none", "---\ndate: 2026-13-45\n---\nDeploy."],
  ])("refuses a post with %s, so the build fails", (_, source) => {
    expect(() => parsePost("0.2.0.md", source)).toThrow("0.2.0.md");
  });

  it("reads every post in changelog/", () => {
    const folder = fileURLToPath(new URL("../../changelog", import.meta.url));

    expect(readPosts(folder).get("0.1.0")).toMatchObject({ date: "2026-10-21" });
  });
});

describe("readReleases", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function repository(files: Record<string, string>): string {
    root = mkdtempSync(join(tmpdir(), "changelog-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  it("reads the fixed group's changelogs by their title, without the server's platform packages", () => {
    const repo = repository({
      ".changeset/config.json": JSON.stringify({
        fixed: [
          ["@zitadel/cli", "@zitadel/server-linux-x64", "@zitadel/sdk-next", "@zitadel/testing"],
        ],
      }),
      "apps/cli/CHANGELOG.md": CLI,
      "apps/server-linux-x64/CHANGELOG.md":
        "# @zitadel/server-linux-x64\n\n## 0.2.0\n\n- A binary.\n",
      "apps/website/CHANGELOG.md": "# @zitadel/website\n\n## 0.2.0\n\n- A private app.\n",
      "packages/sdk-next/CHANGELOG.md": "# @zitadel/sdk-next\n\n## 0.2.0\n\n- An SDK.\n",
    });

    expect(readChangelogs(repo).map(({ name }) => name)).toEqual([
      "@zitadel/cli",
      "@zitadel/sdk-next",
    ]);
  });

  it("puts each release's post above its changes", () => {
    const repo = repository({
      ".changeset/config.json": JSON.stringify({ fixed: [["@zitadel/cli"]] }),
      "apps/cli/CHANGELOG.md": CLI,
      "packages/.gitkeep": "",
      "apps/website/changelog/0.2.0.md":
        "---\ndate: 2026-10-28\n---\n\nDeploy, preview and roll back.\n",
    });

    expect(readReleases(repo)).toMatchObject([
      { tag: "v0.2.0", date: "2026-10-28", notes: "Deploy, preview and roll back." },
      { tag: "v0.1.0", date: undefined, notes: "" },
    ]);
  });
});
