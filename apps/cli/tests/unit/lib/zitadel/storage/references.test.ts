import { describe, expect, it } from "vitest";

import { ConfigError } from "@/lib/zitadel";
import {
  findFileReferences,
  inlineFileReferences,
  outsideProject,
} from "@/lib/zitadel/storage/references";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The one reference {@link readA} can read.
 */
const A = { $file: "./a.txt" };

/**
 * A reference to a file that is not there.
 */
const GONE = { $file: "./gone" };

/**
 * A reader that knows one file, `./a.txt`, and nothing else.
 *
 * @param ref - The reference as written.
 * @returns Its text, or `undefined` for any other reference.
 */
function readA(ref: string): string | undefined {
  if (ref === A.$file) {
    return "A";
  }
  return undefined;
}

describe("findFileReferences", () => {
  it("finds references in objects and lists, in document order", () => {
    const document = {
      x: { $file: "./x" },
      list: [1, { $file: "./y" }],
      nested: { deep: { $file: "./z" } },
    };

    const found = findFileReferences(document);

    expect(found).toEqual([
      { location: ["x"], ref: "./x" },
      { location: ["list", 1], ref: "./y" },
      { location: ["nested", "deep"], ref: "./z" },
    ]);
  });

  it.each([
    ["an object with keys beside $file", { x: { $file: "./x", other: 1 } }],
    ["a $file that is not a string", { x: { $file: 1 } }],
    ["a scalar", "text"],
  ])("finds nothing in %s", (_what, document) => {
    const found = findFileReferences(document);

    expect(found).toEqual([]);
  });
});

describe("inlineFileReferences", () => {
  it("replaces a reference with the text of its file", () => {
    const inlined = inlineFileReferences({ t: A, keep: 1 }, readA, "throw");

    expect(inlined).toEqual({ t: "A", keep: 1 });
  });

  it("replaces a reference inside a list", () => {
    const inlined = inlineFileReferences({ list: [A] }, readA, "throw");

    expect(inlined).toEqual({ list: ["A"] });
  });

  it("refuses a missing reference under throw", () => {
    const error = thrownBy(() => {
      return inlineFileReferences({ t: GONE }, readA, "throw");
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({ message: '$file "./gone" cannot be read' });
  });

  it("drops the key of a missing reference under omit", () => {
    const inlined = inlineFileReferences({ t: GONE, keep: 1 }, readA, "omit");

    expect(inlined).toEqual({ keep: 1 });
  });

  it("drops the element of a missing reference from a list under omit", () => {
    const inlined = inlineFileReferences({ list: [GONE, A] }, readA, "omit");

    expect(inlined).toEqual({ list: ["A"] });
  });

  it("leaves the document it was given unchanged", () => {
    const document = { t: { $file: "./a.txt" } };

    inlineFileReferences(document, readA, "throw");

    expect(document).toEqual({ t: { $file: "./a.txt" } });
  });
});

describe("outsideProject", () => {
  it("names the reference that leaves the project", () => {
    const error = outsideProject("../x");

    expect(error.message).toBe('$file "../x" points outside the project');
  });

  it("says where a referenced file must be", () => {
    const error = outsideProject("../x");

    expect(error.hint).toContain("inside the project");
  });
});
