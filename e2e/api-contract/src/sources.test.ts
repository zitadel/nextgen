import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { OperationSources } from "./sources";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sources-test-"));
  await mkdir(join(root, "spec", "endpoints", "livez"), { recursive: true });
  await mkdir(join(root, "spec", "bundled"), { recursive: true });
  await writeFile(
    join(root, "spec", "endpoints", "livez", "methods.yaml"),
    "get:\n  operationId: getLive\n  tags:\n    - System\n",
  );
  await writeFile(join(root, "spec", "bundled", "openapi.yaml"), "  operationId: getLive\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("OperationSources", () => {
  test("finds the file and line an operation is defined on", () => {
    expect(new OperationSources(join(root, "spec"), root).find("getLive")).toEqual({
      file: "spec/endpoints/livez/methods.yaml",
      line: 2,
    });
  });

  test("ignores the bundled copy of the spec", () => {
    expect(new OperationSources(join(root, "spec"), root).find("getLive")?.file).not.toContain(
      "bundled",
    );
  });

  test("finds nothing for an operation the source does not have", () => {
    expect(new OperationSources(join(root, "spec"), root).find("nope")).toBeUndefined();
  });
});
