#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun } from "./dev-process.mjs";

const ADR_FILENAME_PATTERN = /^(\d{3})-[a-z0-9-]+\.md$/;
const ADR_HEADING_PATTERN = /^#\s*ADR\s+(\d{3}):\s*(.+)\s*$/;
const README_ROW_PATTERN = /^\|\s*\[(\d{3})\]\(([^)]+)\)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*$/;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultAdrsDir = join(repoRoot, "docs", "adrs");
const readmeFilename = "README.md";

export function parseAdrFilename(name) {
  const match = name.match(ADR_FILENAME_PATTERN);
  if (!match) {
    return null;
  }
  return {
    id: match[1],
    number: Number.parseInt(match[1], 10),
    filename: name,
  };
}

export function scanAdrDirectory(entries) {
  const files = [];
  const errors = [];

  for (const entry of entries) {
    if (entry === readmeFilename) {
      continue;
    }
    if (!entry.endsWith(".md")) {
      errors.push({
        code: "invalid-filename",
        message: `${entry} is not an ADR markdown file; only NNN-slug.md files belong in docs/adrs/`,
      });
      continue;
    }

    const parsed = parseAdrFilename(entry);
    if (!parsed) {
      errors.push({
        code: "invalid-filename",
        message: `${entry} does not match the ADR filename pattern NNN-slug.md`,
      });
      continue;
    }

    files.push(parsed);
  }

  files.sort((left, right) => left.number - right.number);
  return { files, errors };
}

export function parseReadmeIndex(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const indexStart = lines.findIndex((line) => line.trim() === "## Index");
  if (indexStart === -1) {
    throw new Error("docs/adrs/README.md is missing a ## Index section");
  }

  const rows = [];
  for (let index = indexStart + 1; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (!line.startsWith("|")) {
      if (rows.length > 0) {
        break;
      }
      continue;
    }
    if (/^\|\s*[-:]+\s*\|/.test(line)) {
      continue;
    }

    const match = line.match(README_ROW_PATTERN);
    if (!match) {
      if (rows.length > 0) {
        throw new Error(`could not parse README index row: ${line}`);
      }
      continue;
    }

    rows.push({
      id: match[1],
      number: Number.parseInt(match[1], 10),
      filename: match[2].trim(),
      title: match[3].trim(),
      status: match[4].trim(),
      summary: match[5].trim(),
    });
  }

  if (rows.length === 0) {
    throw new Error("docs/adrs/README.md index table has no ADR rows");
  }

  return rows;
}

export function parseAdrHeading(content) {
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(ADR_HEADING_PATTERN);
    if (match) {
      return {
        id: match[1],
        title: match[2].trim(),
      };
    }
  }
  return null;
}

export function validateAdrIndex({ files, readmeRows, headings = new Map() }) {
  const errors = [];
  const filesById = groupBy(files, (file) => file.id);
  const readmeByFilename = groupBy(readmeRows, (row) => row.filename);

  for (const [id, groupedFiles] of filesById) {
    if (groupedFiles.length > 1) {
      errors.push({
        code: "duplicate-id",
        message: `ADR number ${id} is used by multiple files: ${groupedFiles.map((file) => file.filename).join(", ")}`,
      });
    }
  }

  if (files.length > 0) {
    const fileNumbers = new Set(files.map((file) => file.number));
    const maxNumber = files.at(-1).number;
    for (let number = 1; number <= maxNumber; number += 1) {
      if (!fileNumbers.has(number)) {
        errors.push({
          code: "skipped-id",
          message: `ADR sequence skips ${String(number).padStart(3, "0")}; expected contiguous numbering from 001 through ${String(maxNumber).padStart(3, "0")}`,
        });
      }
    }
  }

  const fileByFilename = new Map(files.map((file) => [file.filename, file]));
  for (const row of readmeRows) {
    const file = fileByFilename.get(row.filename);
    if (!file) {
      errors.push({
        code: "readme-stale-entry",
        message: `docs/adrs/README.md links to missing file ${row.filename}`,
      });
      continue;
    }
    if (row.id !== file.id) {
      errors.push({
        code: "readme-id-mismatch",
        message: `docs/adrs/README.md row [${row.id}](${row.filename}) does not match file prefix ${file.id}`,
      });
    }
  }

  for (const file of files) {
    const readmeMatches = readmeByFilename.get(file.filename) ?? [];
    if (readmeMatches.length === 0) {
      errors.push({
        code: "readme-missing-file",
        message: `${file.filename} is missing from docs/adrs/README.md; add an index row for ADR ${file.id}`,
      });
    } else if (readmeMatches.length > 1) {
      errors.push({
        code: "readme-duplicate-entry",
        message: `docs/adrs/README.md lists ${file.filename} ${readmeMatches.length} times`,
      });
    }
  }

  for (let index = 1; index < readmeRows.length; index += 1) {
    const previous = readmeRows[index - 1];
    const current = readmeRows[index];
    if (current.number <= previous.number) {
      errors.push({
        code: "readme-order",
        message: `docs/adrs/README.md index is out of order at ${current.filename}; expected ascending ADR numbers`,
      });
    }
  }

  if (readmeRows.length > 0) {
    const readmeNumbers = new Set(readmeRows.map((row) => row.number));
    const maxReadmeNumber = readmeRows.at(-1).number;
    for (let number = 1; number <= maxReadmeNumber; number += 1) {
      if (!readmeNumbers.has(number)) {
        errors.push({
          code: "readme-order",
          message: `docs/adrs/README.md index skips ADR ${String(number).padStart(3, "0")}`,
        });
      }
    }
  }

  if (files.length > 0 && readmeRows.length > 0 && files.length !== readmeRows.length) {
    errors.push({
      code: "readme-count-mismatch",
      message: `docs/adrs/README.md lists ${readmeRows.length} ADRs but docs/adrs/ contains ${files.length} ADR files`,
    });
  }

  for (const file of files) {
    const heading = headings.get(file.filename);
    if (!heading) {
      errors.push({
        code: "heading-missing",
        message: `${file.filename} is missing a top-level '# ADR NNN:' heading`,
      });
      continue;
    }
    if (heading.id !== file.id) {
      errors.push({
        code: "heading-id-mismatch",
        message: `${file.filename} heading uses ADR ${heading.id} but filename prefix is ${file.id}`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    count: files.length,
  };
}

export async function checkAdrsIndex(options = {}) {
  const adrsDir = options.adrsDir ?? defaultAdrsDir;
  const entries = options.entries ?? (await readdir(adrsDir));
  const { files, errors: scanErrors } = scanAdrDirectory(entries);

  const readmePath = join(adrsDir, readmeFilename);
  const readmeMarkdown =
    options.readmeMarkdown ?? (await readFile(readmePath, "utf8"));
  const readmeRows = parseReadmeIndex(readmeMarkdown);

  const headings = options.headings ?? new Map();
  if (!options.headings) {
    for (const file of files) {
      const content = await readFile(join(adrsDir, file.filename), "utf8");
      const heading = parseAdrHeading(content);
      if (heading) {
        headings.set(file.filename, heading);
      }
    }
  }

  const validation = validateAdrIndex({ files, readmeRows, headings });
  return {
    ok: scanErrors.length === 0 && validation.ok,
    errors: [...scanErrors, ...validation.errors],
    count: validation.count,
  };
}

export async function main() {
  const args = forwardedArgs();
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return 0;
  }

  const report = await checkAdrsIndex();
  if (report.ok) {
    console.log(`adr index: ok (${report.count} records)`);
    return 0;
  }

  console.error("adr index: failed");
  for (const error of report.errors) {
    console.error(`- ${error.message}`);
  }
  return 1;
}

function groupBy(items, selector) {
  const groups = new Map();
  for (const item of items) {
    const key = selector(item);
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return groups;
}

function printUsage() {
  console.log(`Usage: node scripts/check-adrs-index.mjs

Validates ADR numbering, docs/adrs/README.md index sync, and ADR heading IDs.
`);
}

if (isDirectRun(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
