import { describe, expect, it } from "vitest";

type CheckAdrsIndexModule = {
  parseAdrFilename: (name: string) => { id: string; number: number; filename: string } | null;
  scanAdrDirectory: (entries: string[]) => {
    files: Array<{ id: string; number: number; filename: string }>;
    errors: Array<{ code: string; message: string }>;
  };
  parseReadmeIndex: (markdown: string) => Array<{
    id: string;
    number: number;
    filename: string;
    title: string;
    status: string;
    summary: string;
  }>;
  validateAdrIndex: (options: {
    files: Array<{ id: string; number: number; filename: string }>;
    readmeRows: Array<{
      id: string;
      number: number;
      filename: string;
      title: string;
      status: string;
      summary: string;
    }>;
    headings?: Map<string, { id: string; title: string }>;
  }) => { ok: boolean; errors: Array<{ code: string; message: string }>; count: number };
};

async function loadModule(): Promise<CheckAdrsIndexModule> {
  return (await import(
    new URL("../../../../../scripts/check-adrs-index.mjs", import.meta.url).href
  )) as CheckAdrsIndexModule;
}

const sampleReadme = `# Architecture Decision Records

## Index

| ID | Title | Status | Summary |
|---|---|---|---|
| [001](001-first.md) | First ADR | Proposed | Summary one. |
| [002](002-second.md) | Second ADR | Proposed | Summary two. |
| [003](003-third.md) | Third ADR | Proposed | Summary three. |
`;

function sampleFiles() {
  return [
    { id: "001", number: 1, filename: "001-first.md" },
    { id: "002", number: 2, filename: "002-second.md" },
    { id: "003", number: 3, filename: "003-third.md" },
  ];
}

function sampleHeadings() {
  return new Map([
    ["001-first.md", { id: "001", title: "First ADR" }],
    ["002-second.md", { id: "002", title: "Second ADR" }],
    ["003-third.md", { id: "003", title: "Third ADR" }],
  ]);
}

describe("check-adrs-index", () => {
  it("parses valid ADR filenames", async () => {
    const { parseAdrFilename } = await loadModule();
    expect(parseAdrFilename("001-server-cli-cobra-viper.md")).toEqual({
      id: "001",
      number: 1,
      filename: "001-server-cli-cobra-viper.md",
    });
    expect(parseAdrFilename("README.md")).toBeNull();
    expect(parseAdrFilename("009-cursor-based-pagination.md")).toEqual({
      id: "009",
      number: 9,
      filename: "009-cursor-based-pagination.md",
    });
  });

  it("passes when files, README, and headings are in sync", async () => {
    const { parseReadmeIndex, validateAdrIndex } = await loadModule();
    const report = validateAdrIndex({
      files: sampleFiles(),
      readmeRows: parseReadmeIndex(sampleReadme),
      headings: sampleHeadings(),
    });

    expect(report.ok).toBe(true);
    expect(report.count).toBe(3);
    expect(report.errors).toEqual([]);
  });

  it("fails when two files share the same ADR number", async () => {
    const { parseReadmeIndex, validateAdrIndex } = await loadModule();
    const report = validateAdrIndex({
      files: [
        { id: "009", number: 9, filename: "009-user-json-schema-validation.md" },
        { id: "009", number: 9, filename: "009-cursor-based-pagination.md" },
        { id: "010", number: 10, filename: "010-session-auth-attempt-check-model.md" },
      ],
      readmeRows: parseReadmeIndex(`# ADRs

## Index

| ID | Title | Status | Summary |
|---|---|---|---|
| [009](009-user-json-schema-validation.md) | User JSON Schema Validation | Proposed | Summary. |
| [010](010-session-auth-attempt-check-model.md) | Session Model | Proposed | Summary. |
`),
      headings: new Map([
        ["009-user-json-schema-validation.md", { id: "009", title: "User JSON Schema Validation" }],
        ["009-cursor-based-pagination.md", { id: "009", title: "Cursor-Based Pagination" }],
        ["010-session-auth-attempt-check-model.md", { id: "010", title: "Session Model" }],
      ]),
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.code === "duplicate-id")).toBe(true);
  });

  it("fails when ADR numbering skips an id", async () => {
    const { parseReadmeIndex, validateAdrIndex } = await loadModule();
    const report = validateAdrIndex({
      files: [
        { id: "001", number: 1, filename: "001-first.md" },
        { id: "003", number: 3, filename: "003-third.md" },
      ],
      readmeRows: parseReadmeIndex(`# ADRs

## Index

| ID | Title | Status | Summary |
|---|---|---|---|
| [001](001-first.md) | First ADR | Proposed | Summary one. |
| [003](003-third.md) | Third ADR | Proposed | Summary three. |
`),
      headings: sampleHeadings(),
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.code === "skipped-id")).toBe(true);
  });

  it("fails when README is missing an ADR file", async () => {
    const { parseReadmeIndex, validateAdrIndex } = await loadModule();
    const report = validateAdrIndex({
      files: sampleFiles(),
      readmeRows: parseReadmeIndex(`# ADRs

## Index

| ID | Title | Status | Summary |
|---|---|---|---|
| [001](001-first.md) | First ADR | Proposed | Summary one. |
| [002](002-second.md) | Second ADR | Proposed | Summary two. |
`),
      headings: sampleHeadings(),
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.code === "readme-missing-file")).toBe(true);
  });

  it("fails when README links to a missing file", async () => {
    const { parseReadmeIndex, validateAdrIndex } = await loadModule();
    const report = validateAdrIndex({
      files: sampleFiles(),
      readmeRows: parseReadmeIndex(`# ADRs

## Index

| ID | Title | Status | Summary |
|---|---|---|---|
| [001](001-first.md) | First ADR | Proposed | Summary one. |
| [002](002-second.md) | Second ADR | Proposed | Summary two. |
| [003](003-missing.md) | Third ADR | Proposed | Summary three. |
`),
      headings: sampleHeadings(),
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.code === "readme-stale-entry")).toBe(true);
  });

  it("fails when an ADR heading id does not match the filename", async () => {
    const { parseReadmeIndex, validateAdrIndex } = await loadModule();
    const report = validateAdrIndex({
      files: sampleFiles(),
      readmeRows: parseReadmeIndex(sampleReadme),
      headings: new Map([
        ["001-first.md", { id: "001", title: "First ADR" }],
        ["002-second.md", { id: "002", title: "Second ADR" }],
        ["003-third.md", { id: "002", title: "Wrong heading id" }],
      ]),
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.code === "heading-id-mismatch")).toBe(true);
  });

  it("scanAdrDirectory ignores README and rejects invalid filenames", async () => {
    const { scanAdrDirectory } = await loadModule();
    const report = scanAdrDirectory([
      "README.md",
      "001-first.md",
      "notes.txt",
      "bad-name.md",
    ]);

    expect(report.files).toEqual([
      { id: "001", number: 1, filename: "001-first.md" },
    ]);
    expect(report.errors.map((error) => error.code)).toEqual([
      "invalid-filename",
      "invalid-filename",
    ]);
  });
});
