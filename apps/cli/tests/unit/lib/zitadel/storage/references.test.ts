import { describe, expect, it } from "vitest";

import { findFileReferences, inlineFileReferences, outsideProject } from "@/lib/zitadel/storage/references";

/**
 * A reader that knows one file, `./a.txt`, and nothing else.
 *
 * @param ref - The reference as written.
 * @returns Its text, or `undefined` for any other reference.
 */
function readA(ref: string): string | undefined {
  return ref === "./a.txt" ? "A" : undefined;
}

describe("findFileReferences", () => {
  it("finds references in objects and lists, in document order", () => {
    const document = { x: { $file: "./x" }, list: [1, { $file: "./y" }], nested: { deep: { $file: "./z" } } };

    expect(findFileReferences(document)).toEqual([
      { location: ["x"], ref: "./x" },
      { location: ["list", 1], ref: "./y" },
      { location: ["nested", "deep"], ref: "./z" },
    ]);
  });

  it("ignores an object with keys beside $file", () => {
    expect(findFileReferences({ x: { $file: "./x", other: 1 } })).toEqual([]);
  });

  it("ignores a $file that is not a string", () => {
    expect(findFileReferences({ x: { $file: 1 } })).toEqual([]);
  });

  it("finds nothing in a scalar", () => {
    expect(findFileReferences("text")).toEqual([]);
  });
});

describe("inlineFileReferences", () => {
  it("replaces a reference with the text of its file", () => {
    expect(inlineFileReferences({ t: { $file: "./a.txt" }, keep: 1 }, readA, "throw")).toEqual({ t: "A", keep: 1 });
  });

  it("replaces a reference inside a list", () => {
    expect(inlineFileReferences({ list: [{ $file: "./a.txt" }] }, readA, "throw")).toEqual({ list: ["A"] });
  });

  it("refuses a missing reference under throw", () => {
    expect(() => {
      return inlineFileReferences({ t: { $file: "./gone" } }, readA, "throw");
    }).toThrow('$file "./gone" cannot be read');
  });

  it("drops the key of a missing reference under omit", () => {
    expect(inlineFileReferences({ t: { $file: "./gone" }, keep: 1 }, readA, "omit")).toEqual({ keep: 1 });
  });

  it("drops the element of a missing reference from a list under omit", () => {
    expect(inlineFileReferences({ list: [{ $file: "./gone" }, { $file: "./a.txt" }] }, readA, "omit")).toEqual({
      list: ["A"],
    });
  });

  it("leaves the document it was given unchanged", () => {
    const document = { t: { $file: "./a.txt" } };

    inlineFileReferences(document, readA, "throw");

    expect(document).toEqual({ t: { $file: "./a.txt" } });
  });
});

describe("outsideProject", () => {
  it("names the reference that leaves the project", () => {
    expect(outsideProject("../x").message).toBe('$file "../x" points outside the project');
  });

  it("says where a referenced file must be", () => {
    expect(outsideProject("../x").hint).toContain("inside the project");
  });
});
