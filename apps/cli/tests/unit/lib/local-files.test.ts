import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import {
  findFileReferences,
  inlineFileReferences,
  isFileReference,
  resolveFileReference,
  restoreFileReferences,
} from "../../../src/lib/local-files";

const baseDir = ".zitadel/branding";

/** A throwaway project with `.zitadel/branding/login.liquid` seeded. */
async function makeProject(template = "<p>local</p>"): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-local-files-"));
  await mkdir(join(cwd, baseDir), { recursive: true });
  await writeFile(join(cwd, baseDir, "login.liquid"), template);
  return cwd;
}

describe("isFileReference", () => {
  it("matches only an object whose single key is a string $file", () => {
    expect(isFileReference({ $file: "./login.liquid" })).toBe(true);
    expect(isFileReference({ $file: "./login.liquid", extra: 1 })).toBe(false);
    expect(isFileReference({ $file: 1 })).toBe(false);
    expect(isFileReference("./login.liquid")).toBe(false);
    expect(isFileReference([{ $file: "./login.liquid" }])).toBe(false);
    expect(isFileReference(null)).toBe(false);
  });
});

describe("resolveFileReference", () => {
  it("resolves relative to the base directory", async () => {
    const cwd = await makeProject();
    expect(resolveFileReference({ cwd, baseDir }, "./login.liquid")).toBe(
      join(cwd, baseDir, "login.liquid"),
    );
  });

  it("refuses paths that leave the project", async () => {
    const cwd = await makeProject();
    const context = { cwd, baseDir };
    expect(() => resolveFileReference(context, "../../../outside.liquid")).toThrow(ZitadelError);
    expect(() => resolveFileReference(context, "/etc/passwd")).toThrow(ZitadelError);
  });

  it("allows a file whose name only starts with two dots", async () => {
    const cwd = await makeProject();
    expect(resolveFileReference({ cwd, baseDir: "." }, "..hidden.liquid")).toBe(
      join(cwd, "..hidden.liquid"),
    );
  });
});

describe("findFileReferences", () => {
  it("reports every reference with its path, including inside arrays", () => {
    expect(
      findFileReferences({
        a: { $file: "./a.txt" },
        list: [{ nested: { $file: "./b.txt" } }],
        plain: "value",
      }),
    ).toEqual([
      { path: ["a"], ref: "./a.txt" },
      { path: ["list", 0, "nested"], ref: "./b.txt" },
    ]);
  });
});

describe("inlineFileReferences", () => {
  it("replaces references with file content and leaves the input untouched", async () => {
    const cwd = await makeProject("<p>template</p>");
    const document = { layout: "split", liquid_template: { $file: "./login.liquid" } };

    const inlined = inlineFileReferences(document, { cwd, baseDir }, { onMissing: "throw" });

    expect(inlined).toEqual({ layout: "split", liquid_template: "<p>template</p>" });
    expect(document.liquid_template).toEqual({ $file: "./login.liquid" });
  });

  it("throws E_VALIDATION on an unreadable file when asked to", async () => {
    const cwd = await makeProject();
    const document = { t: { $file: "./missing.liquid" } };
    expect(() => inlineFileReferences(document, { cwd, baseDir }, { onMissing: "throw" })).toThrow(
      /cannot be read/,
    );
  });

  it("drops the key or array element of an unreadable file when asked to omit", async () => {
    const cwd = await makeProject("<p>template</p>");
    const document = {
      layout: "split",
      t: { $file: "./missing.liquid" },
      list: [{ $file: "./missing.liquid" }, { $file: "./login.liquid" }],
    };
    expect(inlineFileReferences(document, { cwd, baseDir }, { onMissing: "omit" })).toEqual({
      layout: "split",
      list: ["<p>template</p>"],
    });
  });

  it("still refuses paths that leave the project when omitting", async () => {
    const cwd = await makeProject();
    const document = { t: { $file: "../../../x" } };
    expect(() => inlineFileReferences(document, { cwd, baseDir }, { onMissing: "omit" })).toThrow(
      ZitadelError,
    );
  });
});

describe("restoreFileReferences", () => {
  it("writes a differing canonical value to the file and keeps the reference", async () => {
    const cwd = await makeProject("<p>local</p>");
    const local = { layout: "split", liquid_template: { $file: "./login.liquid" } };
    const canonical = { layout: "split", liquid_template: "<p>server</p>" };

    const { document, written } = restoreFileReferences(canonical, local, { cwd, baseDir });

    expect(document).toEqual(local);
    expect(written).toEqual(["./login.liquid"]);
    const onDisk = await readFile(join(cwd, baseDir, "login.liquid"), "utf8");
    expect(onDisk).toBe("<p>server</p>");
    expect(canonical.liquid_template).toBe("<p>server</p>");
  });

  it("does not rewrite a file whose content already matches", async () => {
    const cwd = await makeProject("<p>same</p>");
    const { written } = restoreFileReferences(
      { liquid_template: "<p>same</p>" },
      { liquid_template: { $file: "./login.liquid" } },
      { cwd, baseDir },
    );
    expect(written).toEqual([]);
  });

  it("leaves the canonical value alone where the local document has no reference", async () => {
    const cwd = await makeProject();
    const canonical = { liquid_template: "<p>inline</p>" };
    const { document, written } = restoreFileReferences(
      canonical,
      { liquid_template: "<p>inline</p>" },
      { cwd, baseDir },
    );
    expect(document).toEqual(canonical);
    expect(written).toEqual([]);
  });
});
