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
  createInitialReleaseBody,
  fitGeneratedReleaseFacts,
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
