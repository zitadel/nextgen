import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Baseline } from "./baseline";

let directory: string;
let path: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "baseline-test-"));
  path = join(directory, "known-failures.json");
  await writeFile(
    path,
    JSON.stringify([
      { operation: "GET /a", check: "Server error" },
      { operation: "GET /b", check: "Server error" },
    ]),
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Baseline", () => {
  test("accepts a failure it lists", () => {
    const failures = [{ operation: "GET /a", check: "Server error", count: 3 }];

    expect(new Baseline(path).verdict("GET /a", failures)).toEqual([]);
  });

  test("rejects a failure it does not list", () => {
    const failures = [
      { operation: "GET /a", check: "Server error", count: 1 },
      { operation: "GET /a", check: "Response violates schema", count: 2 },
    ];

    expect(new Baseline(path).verdict("GET /a", failures)).toEqual([
      'New failure: "Response violates schema" (2 requests).',
    ]);
  });

  test("rejects a listed failure that no longer happens", () => {
    expect(new Baseline(path).verdict("GET /b", [])).toEqual([
      '"Server error" no longer fails. Remove it from known-failures.json to keep the ratchet.',
    ]);
  });

  test("has nothing to say about an operation that passes and is not listed", () => {
    expect(new Baseline(path).verdict("GET /c", [])).toEqual([]);
  });

  test("names the operations that the spec does not have", () => {
    expect(new Baseline(path).unknownOperations(["GET /a"])).toEqual(["GET /b"]);
  });

  test("writes the failures as the operation and check, without the counts", async () => {
    new Baseline(path).write([{ operation: "GET /z", check: "Server error", count: 9 }]);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([
      { operation: "GET /z", check: "Server error" },
    ]);
  });
});
