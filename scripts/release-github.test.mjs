import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  GENERATED_BLOCK_END,
  GENERATED_BLOCK_START,
  GITHUB_RELEASE_BODY_MAX_CHARS,
  PRODUCT_NOTES_PLACEHOLDER,
  collectReleaseChanges,
  createInitialReleaseBody,
  extractVersionSection,
  fitGeneratedReleaseFacts,
  parseChangelogEntries,
  renderGeneratedReleaseFacts,
  upsertGeneratedBlock,
  upsertProductGithubRelease,
} from "./release-github.mjs";

const TAG = "v9.9.9-alpha.1";

function fakeMetadata(packages) {
  return {
    version: "9.9.9-alpha.1",
    tag: TAG,
    shortCommit: "abcdef12",
    image: "ghcr.io/zitadel/nextgen",
    imageTags: ["ghcr.io/zitadel/nextgen:9.9.9-alpha.1"],
    packages,
  };
}

// A change of the package named `@x/<short>`, its text `length` long.
function fakeChange(short, bump, length, prefix = "") {
  return {
    text: `${prefix}${short[0].repeat(length - prefix.length)}`,
    bump,
    packages: [`@x/${short}`],
  };
}

function fakePackages(...shorts) {
  return shorts.map((short) => ({
    name: `@x/${short}`,
    version: "9.9.9-alpha.1",
    path: `packages/${short}`,
  }));
}

async function writeChangelogFixture(packages) {
  const repoRoot = await mkdtemp(join(tmpdir(), "release-github-test-"));
  for (const pkg of packages) {
    const dir = join(repoRoot, pkg.path);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "CHANGELOG.md"),
      `# ${pkg.name}\n\n## ${pkg.version}\n\n### ${pkg.group ?? "Patch Changes"}\n\n- ${pkg.entry}\n`,
    );
  }
  return repoRoot;
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

const GITHUB_ENV = {
  GITHUB_TOKEN: "test-token",
  GITHUB_REPOSITORY: "zitadel/nextgen",
  GITHUB_SHA: "deadbeef",
};

test("collectReleaseChanges lists each change once, with its packages and highest bump, without dependency-only or platform package noise", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "release-github-test-"));
  const write = async (path, source) => {
    await mkdir(join(repoRoot, path), { recursive: true });
    await writeFile(join(repoRoot, path, "CHANGELOG.md"), source);
  };

  await write(
    "apps/cli",
    `# @zitadel/cli

## 0.1.0-alpha.9

### Minor Changes

- [#321](https://github.com/zitadel/nextgen/pull/321) - Add product release drafts.

### Patch Changes

- [#322](https://github.com/zitadel/nextgen/pull/322) - Sessions now belong to the
  app's own project.

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- Older entry.
`,
  );
  // The same change, rewrapped, and a minor in this package.
  await write(
    "apps/server",
    `# @zitadel/server

## 0.1.0-alpha.9

### Minor Changes

- [#322](https://github.com/zitadel/nextgen/pull/322) - Sessions now belong to
  the app's own project.
`,
  );
  await write(
    "apps/server-linux-x64",
    `# @zitadel/server-linux-x64

## 0.1.0-alpha.9

### Patch Changes

- Platform package implementation detail.
`,
  );
  await write(
    "packages/sdk-next",
    `# @zitadel/sdk-next

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.9
`,
  );

  const changes = await collectReleaseChanges({
    repoRoot,
    metadata: fakeMetadata([
      { name: "@zitadel/cli", version: "0.1.0-alpha.9", path: "apps/cli" },
      { name: "@zitadel/server", version: "0.1.0-alpha.9", path: "apps/server" },
      {
        name: "@zitadel/server-linux-x64",
        version: "0.1.0-alpha.9",
        path: "apps/server-linux-x64",
      },
      { name: "@zitadel/sdk-next", version: "0.1.0-alpha.9", path: "packages/sdk-next" },
    ]),
  });

  assert.deepEqual(changes, [
    {
      text: "[#321](https://github.com/zitadel/nextgen/pull/321) - Add product release drafts.",
      bump: "minor",
      packages: ["@zitadel/cli"],
    },
    {
      text: "[#322](https://github.com/zitadel/nextgen/pull/322) - Sessions now belong to the\napp's own project.",
      bump: "minor",
      packages: ["@zitadel/cli", "@zitadel/server"],
    },
  ]);
});

test("extractVersionSection returns only the requested version's lines", () => {
  const source = "# package\n\n## 1.1.0\n\nCurrent entry\n\n## 1.0.0\n\nOld entry";
  const section = extractVersionSection(source, "1.1.0");
  assert.ok(section.includes("Current entry"));
  assert.ok(!section.includes("Old entry"));
});

test("parseChangelogEntries reads each item under its bump, without its marker and indent", () => {
  const section = [
    "No changes in this release.",
    "",
    "### Major Changes",
    "",
    "- Drops the old flag.",
    "  ",
    "  **Breaking:** scripts that pass it fail.",
    "",
    "  - `--old` is gone.",
    "",
    "### Patch Changes",
    "",
    "- A line a formatter wrapped",
    "without an indent.",
    "- A tight item.",
    "",
    "A paragraph outside any item.",
  ].join("\n");

  assert.deepEqual(parseChangelogEntries(section), [
    {
      text: "Drops the old flag.\n\n**Breaking:** scripts that pass it fail.\n\n- `--old` is gone.",
      bump: "major",
    },
    { text: "A line a formatter wrapped\nwithout an indent.", bump: "patch" },
    { text: "A tight item.", bump: "patch" },
    { text: "A paragraph outside any item.", bump: "patch" },
  ]);
});

test("upsertGeneratedBlock replaces only the managed block and preserves human prose", () => {
  const oldBody = `Human intro.\n\n${GENERATED_BLOCK_START}\nold generated facts\n${GENERATED_BLOCK_END}\n\nHuman tail.`;
  const nextBlock = `${GENERATED_BLOCK_START}\nnew generated facts\n${GENERATED_BLOCK_END}`;

  const nextBody = upsertGeneratedBlock(oldBody, nextBlock);

  assert.ok(nextBody.includes("Human intro."));
  assert.ok(nextBody.includes("Human tail."));
  assert.ok(nextBody.includes("new generated facts"));
  assert.ok(!nextBody.includes("old generated facts"));
});

test("upsertGeneratedBlock appends a block when an existing body has none", () => {
  const nextBlock = `${GENERATED_BLOCK_START}\ngenerated facts\n${GENERATED_BLOCK_END}`;
  assert.equal(
    upsertGeneratedBlock("Human release notes.", nextBlock),
    `Human release notes.\n\n${nextBlock}`,
  );
});

test("fitGeneratedReleaseFacts keeps every change when the block fits", () => {
  const metadata = fakeMetadata(fakePackages("server", "cli"));
  const changes = [fakeChange("server", "minor", 500), fakeChange("cli", "patch", 300)];

  const result = fitGeneratedReleaseFacts({
    metadata,
    changes,
    fits: (block) => block.length <= GITHUB_RELEASE_BODY_MAX_CHARS,
  });

  assert.equal(result.fits, true);
  assert.deepEqual(result.omitted, []);
  assert.ok(result.block.includes(`#### Minor Changes\n\n- \`@x/server\`: ${changes[0].text}`));
  assert.ok(result.block.includes(`#### Patch Changes\n\n- \`@x/cli\`: ${changes[1].text}`));
});

test("fitGeneratedReleaseFacts omits patch changes before minor ones, the longest first, and never a breaking one", () => {
  const metadata = fakeMetadata(fakePackages("api", "cli", "server", "testing", "web"));
  const [breaking, major, minor, longPatch, shortPatch] = [
    fakeChange("server", "minor", 60000, "**Breaking:** "),
    fakeChange("api", "major", 10000),
    fakeChange("cli", "minor", 30000),
    fakeChange("web", "patch", 40000),
    fakeChange("testing", "patch", 1000),
  ];
  const changes = [shortPatch, breaking, longPatch, major, minor];

  const result = fitGeneratedReleaseFacts({
    metadata,
    changes,
    fits: (block) => createInitialReleaseBody(block).length <= 100000,
  });

  assert.equal(result.fits, true);
  assert.deepEqual(result.omitted, [longPatch, shortPatch, minor]);
  for (const kept of [breaking, major]) {
    assert.ok(result.block.includes(kept.text));
  }
  for (const omitted of result.omitted) {
    assert.ok(!result.block.includes(omitted.text));
  }
  assert.ok(
    result.block.includes(
      `#### Minor Changes\n\n- \`@x/server\`: ${breaking.text}\n\n_1 minor change omitted to keep this release body under GitHub's ${GITHUB_RELEASE_BODY_MAX_CHARS}-character limit; see \`packages/cli/CHANGELOG.md\` at tag \`${TAG}\`._`,
    ),
  );
  assert.ok(
    result.block.includes(
      `#### Patch Changes\n\n_2 patch changes omitted to keep this release body under GitHub's ${GITHUB_RELEASE_BODY_MAX_CHARS}-character limit; see \`packages/testing/CHANGELOG.md\` and \`packages/web/CHANGELOG.md\` at tag \`${TAG}\`._`,
    ),
  );
  assert.ok(result.block.startsWith(GENERATED_BLOCK_START));
  assert.ok(result.block.endsWith(GENERATED_BLOCK_END));
});

test("fitGeneratedReleaseFacts reports failure when only breaking changes are left", () => {
  const metadata = fakeMetadata(fakePackages("cli", "server"));
  const breaking = fakeChange("server", "minor", 200, "**Breaking:** ");
  const patch = fakeChange("cli", "patch", 100);

  const result = fitGeneratedReleaseFacts({
    metadata,
    changes: [breaking, patch],
    fits: () => false,
  });

  assert.equal(result.fits, false);
  assert.deepEqual(result.omitted, [patch]);
  assert.ok(result.block.includes(breaking.text));
});

test("dry run caps the created release body at the GitHub limit", async () => {
  const packages = [
    { name: "@x/huge", path: "packages/huge", version: "9.9.9-alpha.1", entry: "y".repeat(130000) },
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  const result = await upsertProductGithubRelease({
    repoRoot,
    metadata,
    dryRun: true,
    log: () => {},
  });

  assert.equal(result.action, "dry-run");
  assert.deepEqual(
    result.omittedChanges.map(({ packages }) => packages),
    [["@x/huge"]],
  );
  assert.ok(result.body.length <= GITHUB_RELEASE_BODY_MAX_CHARS);
  assert.ok(result.body.startsWith(PRODUCT_NOTES_PLACEHOLDER));
  assert.ok(result.body.includes("packages/huge/CHANGELOG.md"));
  assert.ok(result.body.includes("- `@x/tiny`: a small fix"));
});

test("a breaking change too long for the body fails the release instead of being omitted", async () => {
  const packages = [
    {
      name: "@x/huge",
      path: "packages/huge",
      version: "9.9.9-alpha.1",
      group: "Minor Changes",
      entry: `Drops a flag.\n\n  **Breaking:** ${"y".repeat(130000)}`,
    },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  await assert.rejects(
    upsertProductGithubRelease({ repoRoot, metadata, dryRun: true, log: () => {} }),
    /even with every change but the breaking ones omitted/,
  );
});

test("update path preserves product notes and fits the body around them", async () => {
  const packages = [
    { name: "@x/huge", path: "packages/huge", version: "9.9.9-alpha.1", entry: "y".repeat(90000) },
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  const productNotes = `# Highlights\n\n${"n".repeat(60000)}`;
  const staleBlock = `${GENERATED_BLOCK_START}\nstale facts\n${GENERATED_BLOCK_END}`;
  const existingBody = `${productNotes}\n\n${staleBlock}`;

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if ((init.method ?? "GET") === "GET") {
      return jsonResponse([{ id: 7, tag_name: TAG, body: existingBody }]);
    }
    return jsonResponse({ id: 7 });
  };

  const result = await upsertProductGithubRelease({
    repoRoot,
    metadata,
    env: GITHUB_ENV,
    fetchImpl,
    log: () => {},
  });

  assert.equal(result.action, "update");
  assert.deepEqual(
    result.omittedChanges.map(({ packages }) => packages),
    [["@x/huge"]],
  );

  const patch = calls.find((call) => call.init.method === "PATCH");
  assert.ok(patch, "expected a PATCH call");
  const patchedBody = JSON.parse(patch.init.body).body;
  assert.ok(patchedBody.length <= GITHUB_RELEASE_BODY_MAX_CHARS);
  assert.ok(patchedBody.startsWith(productNotes));
  assert.ok(!patchedBody.includes("stale facts"));
  assert.ok(patchedBody.includes("packages/huge/CHANGELOG.md"));
  assert.ok(patchedBody.includes("a small fix"));
  assert.ok(patchedBody.includes(GENERATED_BLOCK_START));
  assert.ok(patchedBody.includes(GENERATED_BLOCK_END));
});

test("update path fails loudly when product notes alone exceed the limit", async () => {
  const packages = [
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  const existingBody = [
    "n".repeat(GITHUB_RELEASE_BODY_MAX_CHARS + 1),
    "",
    GENERATED_BLOCK_START,
    "stale facts",
    GENERATED_BLOCK_END,
  ].join("\n");

  const fetchImpl = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "GET") {
      return jsonResponse([{ id: 7, tag_name: TAG, body: existingBody }]);
    }
    throw new Error("unexpected mutation call");
  };

  await assert.rejects(
    upsertProductGithubRelease({ repoRoot, metadata, env: GITHUB_ENV, fetchImpl, log: () => {} }),
    /even with every change but the breaking ones omitted/,
  );
});

test("create path posts a draft prerelease when no release exists for the tag", async () => {
  const packages = [
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return calls.length === 1 ? jsonResponse([]) : jsonResponse({ id: 123 });
  };

  const result = await upsertProductGithubRelease({
    repoRoot,
    metadata,
    env: GITHUB_ENV,
    fetchImpl,
    log: () => {},
  });

  assert.equal(result.action, "create");
  assert.equal(calls[0].init.method, "GET");
  assert.ok(calls[0].url.includes("/releases?per_page=100&page=1"));
  assert.equal(calls[1].init.method, "POST");
  const createBody = JSON.parse(calls[1].init.body);
  assert.equal(createBody.tag_name, TAG);
  assert.equal(createBody.target_commitish, GITHUB_ENV.GITHUB_SHA);
  assert.equal(createBody.draft, true);
  assert.equal(createBody.prerelease, true);
  assert.ok(createBody.body.includes(GENERATED_BLOCK_START));
});

test("existing releases are found by scanning paginated release listings", async () => {
  const packages = [
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    tag_name: `v0.0.0-alpha.${index}`,
    body: "",
  }));
  const existingBody = `${GENERATED_BLOCK_START}\nstale facts\n${GENERATED_BLOCK_END}`;
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return jsonResponse(firstPage);
    }
    if (calls.length === 2) {
      return jsonResponse([{ id: 789, tag_name: TAG, body: existingBody }]);
    }
    return jsonResponse({ id: 789 });
  };

  const result = await upsertProductGithubRelease({
    repoRoot,
    metadata,
    env: GITHUB_ENV,
    fetchImpl,
    log: () => {},
  });

  assert.equal(result.action, "update");
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.github.com/repos/zitadel/nextgen/releases?per_page=100&page=1",
      "https://api.github.com/repos/zitadel/nextgen/releases?per_page=100&page=2",
      "https://api.github.com/repos/zitadel/nextgen/releases/789",
    ],
  );
  assert.equal(calls[2].init.method, "PATCH");
});

test("dry runs never call GitHub", async () => {
  const packages = [
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  let called = false;
  const result = await upsertProductGithubRelease({
    repoRoot,
    metadata,
    dryRun: true,
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
    log: () => {},
  });

  assert.equal(result.action, "dry-run");
  assert.equal(called, false);
});

test("real release creation fails clearly when required env is missing", async () => {
  const packages = [
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  await assert.rejects(
    upsertProductGithubRelease({
      repoRoot,
      metadata,
      env: { GITHUB_REPOSITORY: "zitadel/nextgen", GITHUB_SHA: "deadbeef" },
      fetchImpl: async () => jsonResponse({}),
      log: () => {},
    }),
    /GITHUB_TOKEN/,
  );
});

test("renderGeneratedReleaseFacts still renders the untruncated block", async () => {
  const packages = [
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(
    packages.map(({ name, path, version }) => ({ name, path, version })),
  );

  const block = await renderGeneratedReleaseFacts({ repoRoot, metadata });

  assert.ok(
    block.includes("### Package Changes\n\n#### Patch Changes\n\n- `@x/tiny`: a small fix"),
  );
  const roundTripped = upsertGeneratedBlock(`notes\n\n${block}`, block);
  assert.ok(roundTripped.startsWith("notes"));
});
