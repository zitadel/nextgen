import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  assembleChangelog,
  type Entry,
  type PackageChangelog,
  parseEntry,
  readChangelog,
  readEntries,
  readPackageChangelogs,
} from "./entries";

// Two packages' CHANGELOG.md as Changesets writes them: a changeset's entry,
// its pull request first, in every package it lists.
const CLI = `# @zitadel/cli

## 0.2.0

### Minor Changes

- [#2312](https://github.com/zitadel/nextgen/pull/2312) [\`a1b2c3d\`](https://github.com/zitadel/nextgen/commit/a1b2c3d) Thanks [@fforootd](https://github.com/fforootd)! - Deploy to preview URLs, as [#2187](https://github.com/zitadel/nextgen/pull/2187) did before.

## 0.1.0

### Minor Changes

- [#2187](https://github.com/zitadel/nextgen/pull/2187) Thanks [@fforootd](https://github.com/fforootd)! - Add \`zitadel api\`.

## 1.0.0-alpha.28

### Patch Changes

- [#2157](https://github.com/zitadel/nextgen/pull/2157) - A change in an alpha preview.
`;

const SERVER = `# @zitadel/server

## 0.2.0

### Patch Changes

- [#2312](https://github.com/zitadel/nextgen/pull/2312) - Deploy to preview URLs.
- [#2340](https://github.com/zitadel/nextgen/pull/2340) - Expire previews.
`;

const PACKAGES: PackageChangelog[] = [
  { name: "@zitadel/cli", source: CLI },
  { name: "@zitadel/server", source: SERVER },
];

function entry(fields: Partial<Omit<Entry, "release">> = {}): Omit<Entry, "release"> {
  return {
    slug: "preview-deployments",
    title: "Deploy to preview URLs",
    summary: "Every pull request gets its own login.",
    date: "2026-10-24",
    cloud: false,
    pulls: [],
    body: "",
    ...fields,
  };
}

describe("parseEntry", () => {
  it("reads the front matter and the story after it", () => {
    const source = [
      "---",
      "title: Deploy to preview URLs",
      'summary: "Every pull request gets its own login: a preview URL."',
      "date: 2026-10-24T14:24Z",
      "cloud: true",
      "pulls: [2312, 2340]",
      "---",
      "",
      "Run `zitadel deploy --preview`.",
      "",
    ].join("\n");

    expect(parseEntry("preview-deployments.md", source)).toEqual({
      slug: "preview-deployments",
      title: "Deploy to preview URLs",
      summary: "Every pull request gets its own login: a preview URL.",
      date: "2026-10-24T14:24Z",
      cloud: true,
      pulls: [2312, 2340],
      body: "Run `zitadel deploy --preview`.",
    });
  });

  it("takes an entry without cloud or pulls as neither", () => {
    const source = "---\ntitle: A\nsummary: B\ndate: 2026-10-21\n---\nC";

    expect(parseEntry("a.md", source)).toMatchObject({ cloud: false, pulls: [] });
  });

  it.each([
    ["no front matter", "Run it."],
    ["no title", "---\nsummary: B\ndate: 2026-10-21\n---\n"],
    ["no date", "---\ntitle: A\nsummary: B\n---\n"],
    ["a field it does not know", "---\ntitle: A\nsummary: B\ndate: 2026-10-21\ntags: [CLI]\n---\n"],
    ["a field twice", "---\ntitle: A\ntitle: B\nsummary: B\ndate: 2026-10-21\n---\n"],
    ["a day that is none", "---\ntitle: A\nsummary: B\ndate: 2026-13-45\n---\n"],
    ["a day past its month's end", "---\ntitle: A\nsummary: B\ndate: 2026-02-30\n---\n"],
    ["a time without its zone", "---\ntitle: A\nsummary: B\ndate: 2026-10-21T14:24\n---\n"],
    ["cloud that is no boolean", "---\ntitle: A\nsummary: B\ndate: 2026-10-21\ncloud: yes\n---\n"],
    [
      "pulls that are no numbers",
      "---\ntitle: A\nsummary: B\ndate: 2026-10-21\npulls: [#2312]\n---\n",
    ],
  ])("refuses an entry with %s, so the build fails", (_, source) => {
    expect(() => parseEntry("a.md", source)).toThrow("a.md");
  });

  it("reads every entry in changelog/", () => {
    const folder = fileURLToPath(new URL("../../changelog", import.meta.url));

    expect(readEntries(folder).length).toBeGreaterThan(0);
  });
});

describe("assembleChangelog", () => {
  it("lists the releases from 0.1.0 on, not the alpha previews, the highest first", () => {
    expect(assembleChangelog(PACKAGES, []).releases).toEqual([
      {
        version: "0.2.0",
        tag: "v0.2.0",
        url: "https://github.com/zitadel/nextgen/releases/tag/v0.2.0",
      },
      {
        version: "0.1.0",
        tag: "v0.1.0",
        url: "https://github.com/zitadel/nextgen/releases/tag/v0.1.0",
      },
    ]);
  });

  it("finds an entry's release by the pull requests its changelog entries name first", () => {
    const { entries } = assembleChangelog(PACKAGES, [
      entry({ slug: "api", pulls: [2187] }),
      entry({ slug: "previews", pulls: [2312, 2340] }),
    ]);

    // #2187 is mentioned in a 0.2.0 summary, but its own entry is in 0.1.0.
    expect(entries.map(({ slug, release }) => [slug, release?.tag])).toEqual([
      ["api", "v0.1.0"],
      ["previews", "v0.2.0"],
    ]);
  });

  it("finds no release for an entry until every pull request it names has shipped", () => {
    const { entries } = assembleChangelog(PACKAGES, [
      entry({ slug: "landed", cloud: true, pulls: [2312, 2401] }),
      entry({ slug: "none", pulls: [] }),
      entry({ slug: "alpha", pulls: [2157] }),
    ]);

    expect(entries.map(({ release }) => release)).toEqual([undefined, undefined, undefined]);
  });

  it("puts the newest entry first, by day and time, then by title", () => {
    const { entries } = assembleChangelog(PACKAGES, [
      entry({ slug: "day", date: "2026-10-24" }),
      entry({ slug: "evening", date: "2026-10-24T22:08Z" }),
      entry({ slug: "b", title: "B", date: "2026-10-24T14:24Z" }),
      entry({ slug: "a", title: "A", date: "2026-10-24T14:24Z" }),
      entry({ slug: "later", date: "2026-10-28" }),
    ]);

    expect(entries.map(({ slug }) => slug)).toEqual(["later", "evening", "a", "b", "day"]);
  });
});

describe("readChangelog", () => {
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
      "apps/server-linux-x64/CHANGELOG.md": "# @zitadel/server-linux-x64\n\n## 0.2.0\n",
      "apps/website/CHANGELOG.md": "# @zitadel/website\n\n## 0.2.0\n",
      "packages/sdk-next/CHANGELOG.md": "# @zitadel/sdk-next\n\n## 0.2.0\n",
    });

    expect(readPackageChangelogs(repo).map(({ name }) => name)).toEqual([
      "@zitadel/cli",
      "@zitadel/sdk-next",
    ]);
  });

  it("reads the entries with their releases", () => {
    const repo = repository({
      ".changeset/config.json": JSON.stringify({ fixed: [["@zitadel/cli"]] }),
      "apps/cli/CHANGELOG.md": CLI,
      "packages/.gitkeep": "",
      "apps/website/changelog/zitadel-api.md":
        "---\ntitle: Call any operation\nsummary: With zitadel api.\ndate: 2026-10-21\npulls: [2187]\n---\n\nRun it.\n",
    });

    expect(readChangelog(repo).entries).toMatchObject([
      { slug: "zitadel-api", release: { tag: "v0.1.0" }, body: "Run it." },
    ]);
  });
});
