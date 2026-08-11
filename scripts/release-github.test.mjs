import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  GENERATED_BLOCK_END,
  GENERATED_BLOCK_START,
  GITHUB_RELEASE_BODY_MAX_CHARS,
  PRODUCT_NOTES_PLACEHOLDER,
  collectPackageChangeSections,
  createInitialReleaseBody,
  extractVersionSection,
  fitGeneratedReleaseFacts,
  normalizeChangelogSection,
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

function fakeSection(name, contentLength) {
  return {
    name,
    path: `packages/${name.split("/").pop()}`,
    content: "x".repeat(contentLength),
  };
}

async function writeChangelogFixture(packages) {
  const repoRoot = await mkdtemp(join(tmpdir(), "release-github-test-"));
  for (const pkg of packages) {
    const dir = join(repoRoot, pkg.path);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "CHANGELOG.md"),
      `# ${pkg.name}\n\n## ${pkg.version}\n\n### Patch Changes\n\n- ${pkg.entry}\n`,
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

test("collectPackageChangeSections extracts one version and skips dependency-only or platform package noise", async () => {
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

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- Older entry.
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

  const sections = await collectPackageChangeSections({
    repoRoot,
    metadata: fakeMetadata([
      { name: "@zitadel/cli", version: "0.1.0-alpha.9", path: "apps/cli" },
      { name: "@zitadel/server-linux-x64", version: "0.1.0-alpha.9", path: "apps/server-linux-x64" },
      { name: "@zitadel/sdk-next", version: "0.1.0-alpha.9", path: "packages/sdk-next" },
    ]),
  });

  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "@zitadel/cli");
  assert.ok(sections[0].content.includes("Add product release drafts"));
  assert.ok(!sections[0].content.includes("Updated dependencies"));
  assert.ok(!sections[0].content.includes("Older entry"));
});

test("extractVersionSection returns only the requested version's lines", () => {
  const source = "# package\n\n## 1.1.0\n\nCurrent entry\n\n## 1.0.0\n\nOld entry";
  const section = extractVersionSection(source, "1.1.0");
  assert.ok(section.includes("Current entry"));
  assert.ok(!section.includes("Old entry"));
});

test("normalizeChangelogSection keeps only meaningful change groups", () => {
  assert.equal(
    normalizeChangelogSection("### Patch Changes\n\n- Updated dependencies []:\n  - @zitadel/api@0.1.0-alpha.9\n"),
    "",
  );
  assert.equal(
    normalizeChangelogSection(
      "### Minor Changes\n\n- Add a useful product change.\n\n### Patch Changes\n\n- Updated dependencies []:\n  - @zitadel/api@0.1.0-alpha.9\n",
    ),
    "### Minor Changes\n\n- Add a useful product change.",
  );
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
  assert.equal(upsertGeneratedBlock("Human release notes.", nextBlock), `Human release notes.\n\n${nextBlock}`);
});

test("fitGeneratedReleaseFacts keeps every section when the block fits", () => {
  const metadata = fakeMetadata([]);
  const sections = [fakeSection("@zitadel/server", 500), fakeSection("@zitadel/cli", 300)];

  const result = fitGeneratedReleaseFacts({
    metadata,
    sections,
    fits: (block) => block.length <= GITHUB_RELEASE_BODY_MAX_CHARS,
  });

  assert.equal(result.fits, true);
  assert.deepEqual(result.omitted, []);
  assert.ok(result.block.includes("x".repeat(500)));
  assert.ok(result.block.includes("x".repeat(300)));
});

test("fitGeneratedReleaseFacts stubs the largest section first", () => {
  const metadata = fakeMetadata([]);
  const sections = [
    fakeSection("@zitadel/cli", 5000),
    fakeSection("@zitadel/server", 130000),
    fakeSection("@zitadel/sdk-core", 100),
  ];

  const result = fitGeneratedReleaseFacts({
    metadata,
    sections,
    fits: (block) => createInitialReleaseBody(block).length <= GITHUB_RELEASE_BODY_MAX_CHARS,
  });

  assert.equal(result.fits, true);
  assert.deepEqual(result.omitted, ["@zitadel/server"]);
  assert.ok(createInitialReleaseBody(result.block).length <= GITHUB_RELEASE_BODY_MAX_CHARS);
  assert.ok(result.block.includes("#### `@zitadel/server`"));
  assert.ok(result.block.includes("packages/server/CHANGELOG.md"));
  assert.ok(result.block.includes(`at tag \`${TAG}\``));
  assert.ok(!result.block.includes("x".repeat(130000)));
  assert.ok(result.block.includes("x".repeat(5000)));
  assert.ok(result.block.includes("x".repeat(100)));
  assert.ok(result.block.startsWith(GENERATED_BLOCK_START));
  assert.ok(result.block.endsWith(GENERATED_BLOCK_END));
});

test("fitGeneratedReleaseFacts reports failure when stubbing cannot help", () => {
  const metadata = fakeMetadata([]);
  const sections = [fakeSection("@zitadel/cli", 10)];

  const result = fitGeneratedReleaseFacts({
    metadata,
    sections,
    fits: () => false,
  });

  assert.equal(result.fits, false);
  // The only section is smaller than its stub, so nothing is omitted.
  assert.deepEqual(result.omitted, []);
});

test("dry run caps the created release body at the GitHub limit", async () => {
  const packages = [
    { name: "@x/huge", path: "packages/huge", version: "9.9.9-alpha.1", entry: "y".repeat(130000) },
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(packages.map(({ name, path, version }) => ({ name, path, version })));

  const result = await upsertProductGithubRelease({ repoRoot, metadata, dryRun: true, log: () => {} });

  assert.equal(result.action, "dry-run");
  assert.deepEqual(result.omittedPackages, ["@x/huge"]);
  assert.ok(result.body.length <= GITHUB_RELEASE_BODY_MAX_CHARS);
  assert.ok(result.body.startsWith(PRODUCT_NOTES_PLACEHOLDER));
  assert.ok(result.body.includes("packages/huge/CHANGELOG.md"));
  assert.ok(result.body.includes("a small fix"));
});

test("update path preserves product notes and fits the body around them", async () => {
  const packages = [
    { name: "@x/huge", path: "packages/huge", version: "9.9.9-alpha.1", entry: "y".repeat(90000) },
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(packages.map(({ name, path, version }) => ({ name, path, version })));

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
  assert.deepEqual(result.omittedPackages, ["@x/huge"]);

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
  const metadata = fakeMetadata(packages.map(({ name, path, version }) => ({ name, path, version })));

  const existingBody = [
    "n".repeat(GITHUB_RELEASE_BODY_MAX_CHARS + 1),
    "",
    GENERATED_BLOCK_START,
    "stale facts",
    GENERATED_BLOCK_END,
  ].join("\n");

  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? "GET") === "GET") {
      return jsonResponse([{ id: 7, tag_name: TAG, body: existingBody }]);
    }
    throw new Error("unexpected mutation call");
  };

  await assert.rejects(
    upsertProductGithubRelease({ repoRoot, metadata, env: GITHUB_ENV, fetchImpl, log: () => {} }),
    /even with every package changelog omitted/,
  );
});

test("create path posts a draft prerelease when no release exists for the tag", async () => {
  const packages = [
    { name: "@x/tiny", path: "packages/tiny", version: "9.9.9-alpha.1", entry: "a small fix" },
  ];
  const repoRoot = await writeChangelogFixture(packages);
  const metadata = fakeMetadata(packages.map(({ name, path, version }) => ({ name, path, version })));

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
  const metadata = fakeMetadata(packages.map(({ name, path, version }) => ({ name, path, version })));

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
  const metadata = fakeMetadata(packages.map(({ name, path, version }) => ({ name, path, version })));

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
  const metadata = fakeMetadata(packages.map(({ name, path, version }) => ({ name, path, version })));

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
  const metadata = fakeMetadata(packages.map(({ name, path, version }) => ({ name, path, version })));

  const block = await renderGeneratedReleaseFacts({ repoRoot, metadata });

  assert.ok(block.includes("#### `@x/tiny`"));
  assert.ok(block.includes("a small fix"));
  const roundTripped = upsertGeneratedBlock(`notes\n\n${block}`, block);
  assert.ok(roundTripped.startsWith("notes"));
});
