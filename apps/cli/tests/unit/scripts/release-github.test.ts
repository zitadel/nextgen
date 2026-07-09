import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type ReleaseGithubModule = {
  GENERATED_BLOCK_END: string;
  GENERATED_BLOCK_START: string;
  extractVersionSection: (source: string, version: string) => string;
  normalizeChangelogSection: (section: string) => string;
  renderPackageChanges: (options: { repoRoot: string; metadata: ReleaseMetadata }) => Promise<string>;
  upsertGeneratedBlock: (existingBody: string, generatedBlock: string) => string;
  upsertProductGithubRelease: (options: {
    dryRun?: boolean;
    env?: Record<string, string | undefined>;
    fetchImpl?: (...args: unknown[]) => Promise<unknown>;
    generatedBlock?: string;
    log?: (...args: unknown[]) => void;
    metadata: ReleaseMetadata;
    repoRoot?: string;
  }) => Promise<{ action: string; body: string; tag: string }>;
};

type ReleaseMetadata = {
  version: string;
  tag: string;
  commit: string;
  shortCommit: string;
  imageTags: string[];
  packages: Array<{ name: string; version: string; path: string }>;
};

type FetchInit = { body?: string; method?: string };
type FetchCall = { init: FetchInit; url: string };

const tempDirs: string[] = [];

async function loadModule(): Promise<ReleaseGithubModule> {
  return (await import(
    new URL("../../../../../scripts/release-github.mjs", import.meta.url).href
  )) as ReleaseGithubModule;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("product GitHub release notes", () => {
  it("extracts a single version section and skips dependency-only or platform package noise", async () => {
    const { extractVersionSection, renderPackageChanges } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-notes-"));
    tempDirs.push(repoRoot);

    await writeChangelog(
      repoRoot,
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
    await writeChangelog(
      repoRoot,
      "apps/server-linux-x64",
      `# @zitadel/server-linux-x64

## 0.1.0-alpha.9

### Patch Changes

- Platform package implementation detail.
`,
    );
    await writeChangelog(
      repoRoot,
      "packages/sdk-next",
      `# @zitadel/sdk-next

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.9
`,
    );

    const source = await renderPackageChanges({
      repoRoot,
      metadata: {
        ...metadata(),
        packages: [
          { name: "@zitadel/cli", version: "0.1.0-alpha.9", path: "apps/cli" },
          {
            name: "@zitadel/server-linux-x64",
            version: "0.1.0-alpha.9",
            path: "apps/server-linux-x64",
          },
          { name: "@zitadel/sdk-next", version: "0.1.0-alpha.9", path: "packages/sdk-next" },
        ],
      },
    });

    expect(extractVersionSection(sourceFixture(), "0.1.0-alpha.9")).toContain("Current entry");
    expect(source).toContain("#### `@zitadel/cli`");
    expect(source).toContain("Add product release drafts");
    expect(source).not.toContain("@zitadel/server-linux-x64");
    expect(source).not.toContain("@zitadel/sdk-next");
    expect(source).not.toContain("Updated dependencies");
    expect(source).not.toContain("Older entry");
  });

  it("normalizes changelog sections and leaves only meaningful change groups", async () => {
    const { normalizeChangelogSection } = await loadModule();

    expect(
      normalizeChangelogSection(`### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.9
`),
    ).toBe("");

    expect(
      normalizeChangelogSection(`### Minor Changes

- Add a useful product change.

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.9
`),
    ).toBe(`### Minor Changes

- Add a useful product change.`);
  });

  it("replaces only the managed generated block and preserves human prose", async () => {
    const { GENERATED_BLOCK_END, GENERATED_BLOCK_START, upsertGeneratedBlock } = await loadModule();
    const oldBody = `Human-written intro.

${GENERATED_BLOCK_START}
old generated facts
${GENERATED_BLOCK_END}

Human-written tail.`;
    const nextBlock = `${GENERATED_BLOCK_START}
new generated facts
${GENERATED_BLOCK_END}`;

    const nextBody = upsertGeneratedBlock(oldBody, nextBlock);

    expect(nextBody).toContain("Human-written intro.");
    expect(nextBody).toContain("Human-written tail.");
    expect(nextBody).toContain("new generated facts");
    expect(nextBody).not.toContain("old generated facts");
  });

  it("appends a generated block when an existing release has no managed block", async () => {
    const { GENERATED_BLOCK_END, GENERATED_BLOCK_START, upsertGeneratedBlock } = await loadModule();
    const nextBlock = `${GENERATED_BLOCK_START}
generated facts
${GENERATED_BLOCK_END}`;

    expect(upsertGeneratedBlock("Human release notes.", nextBlock)).toBe(
      `Human release notes.

${nextBlock}`,
    );
  });
});

describe("product GitHub release API", () => {
  it("creates a draft prerelease when no release exists for the tag", async () => {
    const { upsertProductGithubRelease } = await loadModule();
    const calls: FetchCall[] = [];
    const fetchImpl = async (url: unknown, init: unknown) => {
      calls.push(fetchCall(url, init));
      return calls.length === 1 ? jsonResponse(200, []) : jsonResponse(201, { id: 123 });
    };

    const result = await upsertProductGithubRelease({
      metadata: metadata(),
      env: githubEnv(),
      fetchImpl,
      log: () => undefined,
    });

    expect(result.action).toBe("create");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url).toContain("/releases?per_page=100&page=1");
    expect(calls[1].init.method).toBe("POST");
    const createBody = JSON.parse(calls[1].init.body ?? "{}");
    expect(createBody).toMatchObject({
      tag_name: "v0.1.0-alpha.9",
      target_commitish: "abc123",
      draft: true,
      prerelease: true,
    });
    expect(createBody.body).toContain("nextgen-release-facts:start");
  });

  it("patches only the generated block when a release already exists", async () => {
    const { GENERATED_BLOCK_END, GENERATED_BLOCK_START, upsertProductGithubRelease } = await loadModule();
    const calls: FetchCall[] = [];
    const fetchImpl = async (url: unknown, init: unknown) => {
      calls.push(fetchCall(url, init));
      return calls.length === 1
        ? jsonResponse(200, [
            {
              id: 456,
              tag_name: "v0.1.0-alpha.9",
              draft: true,
              body: `Human intro.

${GENERATED_BLOCK_START}
old generated facts
${GENERATED_BLOCK_END}

Human tail.`,
            },
          ])
        : jsonResponse(200, { id: 456 });
    };

    const result = await upsertProductGithubRelease({
      metadata: metadata(),
      env: githubEnv(),
      fetchImpl,
      log: () => undefined,
    });

    expect(result.action).toBe("update");
    expect(calls[1].init.method).toBe("PATCH");
    const patchBody = JSON.parse(calls[1].init.body ?? "{}");
    expect(patchBody.body).toContain("Human intro.");
    expect(patchBody.body).toContain("Human tail.");
    expect(patchBody.body).toContain("Generated Release Facts");
    expect(patchBody.body).not.toContain("old generated facts");
  });

  it("finds existing draft releases by scanning paginated release listings", async () => {
    const { GENERATED_BLOCK_END, GENERATED_BLOCK_START, upsertProductGithubRelease } = await loadModule();
    const calls: FetchCall[] = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      tag_name: `v0.0.0-alpha.${index}`,
      body: "",
    }));
    const fetchImpl = async (url: unknown, init: unknown) => {
      calls.push(fetchCall(url, init));
      if (calls.length === 1) {
        return jsonResponse(200, firstPage);
      }
      if (calls.length === 2) {
        return jsonResponse(200, [
          {
            id: 789,
            tag_name: "v0.1.0-alpha.9",
            draft: true,
            body: `${GENERATED_BLOCK_START}
old generated facts
${GENERATED_BLOCK_END}`,
          },
        ]);
      }
      return jsonResponse(200, { id: 789 });
    };

    const result = await upsertProductGithubRelease({
      metadata: metadata(),
      env: githubEnv(),
      fetchImpl,
      log: () => undefined,
    });

    expect(result.action).toBe("update");
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/zitadel/nextgen/releases?per_page=100&page=1",
      "https://api.github.com/repos/zitadel/nextgen/releases?per_page=100&page=2",
      "https://api.github.com/repos/zitadel/nextgen/releases/789",
    ]);
    expect(calls[2].init.method).toBe("PATCH");
  });

  it("does not call GitHub during dry runs", async () => {
    const { upsertProductGithubRelease } = await loadModule();
    let called = false;

    const result = await upsertProductGithubRelease({
      metadata: metadata(),
      dryRun: true,
      fetchImpl: async () => {
        called = true;
        return jsonResponse(500, {});
      },
      log: () => undefined,
    });

    expect(result.action).toBe("dry-run");
    expect(called).toBe(false);
  });

  it("fails clearly when real GitHub Release creation is missing required env", async () => {
    const { upsertProductGithubRelease } = await loadModule();

    await expect(
      upsertProductGithubRelease({
        metadata: metadata(),
        env: {
          GITHUB_REPOSITORY: "zitadel/nextgen",
          GITHUB_SHA: "abc123",
        },
        fetchImpl: async () => jsonResponse(500, {}),
        log: () => undefined,
      }),
    ).rejects.toThrow("GITHUB_TOKEN");
  });
});

async function writeChangelog(repoRoot: string, packagePath: string, source: string) {
  await mkdir(join(repoRoot, packagePath), { recursive: true });
  await writeFile(join(repoRoot, packagePath, "CHANGELOG.md"), source);
}

function metadata(): ReleaseMetadata {
  return {
    version: "0.1.0-alpha.9",
    tag: "v0.1.0-alpha.9",
    commit: "abc123def456",
    shortCommit: "abc123d",
    imageTags: ["ghcr.io/zitadel/nextgen:0.1.0-alpha.9"],
    packages: [],
  };
}

function githubEnv(): Record<string, string> {
  return {
    GITHUB_REPOSITORY: "zitadel/nextgen",
    GITHUB_SHA: "abc123",
    GITHUB_TOKEN: "token",
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    statusText: status === 404 ? "Not Found" : "OK",
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fetchCall(url: unknown, init: unknown): FetchCall {
  return { url: String(url), init: init as FetchInit };
}

function sourceFixture() {
  return `# package

## 0.1.0-alpha.9

Current entry

## 0.1.0-alpha.8

Old entry`;
}
