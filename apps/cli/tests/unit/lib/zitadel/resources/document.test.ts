import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigDocument, type DocumentFile, type DocumentStatus } from "@/lib/zitadel/resources/document";
import { RefusedEditError } from "@/lib/zitadel/errors";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import { MemoryStore } from "@/lib/zitadel/storage";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * Where the document in these tests sits.
 */
const PATH = ".zitadel/samples/sample.json";

/**
 * The contract a sample is held to: a string `name`, and nothing else.
 */
const SAMPLE_CONTRACT = z.strictObject({ name: z.string() });

/**
 * The smallest document there is, built on nothing but what the base gives.
 */
class Sample extends ConfigDocument {
  /**
   * What kind of document this is: a sample.
   */
  readonly kind = "sample";

  /**
   * Hold a sample's body at its path.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(path: string, body: JsonObject, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a sample as read.
   *
   * @param file - The file.
   * @returns The sample, marked as read.
   */
  static of(file: DocumentFile): Sample {
    return new Sample(file.path, file.body, "read");
  }

  /**
   * A new sample, not yet written.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The sample, marked as created.
   */
  static create(file: DocumentFile): Sample {
    return new Sample(file.path, file.body, "created");
  }

  /**
   * The sample as saved.
   *
   * @returns The same sample, marked as read.
   */
  asRead(): Sample {
    return new Sample(this.path, this.body, "read");
  }

  /**
   * What the sample contract refuses, under a rule borrowed for the test.
   *
   * @param _context - Unused.
   * @returns The findings.
   */
  problems(_context: ValidationContext): readonly Issue[] {
    return this.contractIssues("contract/schema", SAMPLE_CONTRACT);
  }

  /**
   * The body without the editor's pointer.
   *
   * @param _store - Unused.
   * @returns The body.
   */
  wireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The sample renamed.
   *
   * @param name - The new name.
   * @returns The edited sample.
   * @throws {@link RefusedEditError} When `name` is not a string.
   */
  withName(name: string): Sample {
    this.refuseUneditable(typeof this.body.name === "string" ? undefined : "name is not a string");
    return new Sample(this.path, { ...this.body, name }, this.editedStatus);
  }
}

describe("ConfigDocument.changed", () => {
  it("is false for a document as read", () => {
    expect(Sample.of({ path: PATH, body: { name: "a" } }).changed).toBe(false);
  });

  it("is true once a document is edited", () => {
    expect(Sample.of({ path: PATH, body: { name: "a" } }).withName("b").changed).toBe(true);
  });

  it("is true for a new document", () => {
    expect(Sample.create({ path: PATH, body: { name: "a" } }).changed).toBe(true);
  });
});

describe("ConfigDocument.writeMode", () => {
  it("replaces the file of a document that was read", () => {
    expect(Sample.of({ path: PATH, body: { name: "a" } }).writeMode).toBe("replace");
  });

  it("creates the file of a new document", () => {
    expect(Sample.create({ path: PATH, body: { name: "a" } }).writeMode).toBe("create");
  });

  it("still creates the file of a new document after an edit", () => {
    expect(Sample.create({ path: PATH, body: { name: "a" } }).withName("b").writeMode).toBe(
      "create",
    );
  });
});

describe("ConfigDocument.toFile", () => {
  it("gives the path and the body exactly as written", () => {
    const body = { $schema: "../meta/sample.json", name: "a" };

    expect(Sample.of({ path: PATH, body }).toFile()).toEqual({ path: PATH, body });
  });
});

describe("ConfigDocument.asRead", () => {
  it("marks an edited document as read", () => {
    expect(
      Sample.of({ path: PATH, body: { name: "a" } })
        .withName("b")
        .asRead().status,
    ).toBe("read");
  });
});

describe("ConfigDocument.problems", () => {
  it("finds nothing wrong once the editor's pointer is set aside", () => {
    const sample = Sample.of({ path: PATH, body: { $schema: "../meta/sample.json", name: "a" } });

    expect(sample.problems({})).toEqual([]);
  });

  it("reports each refusal with its path, as an error in the file", () => {
    const sample = Sample.of({ path: PATH, body: { name: 7 } });

    expect(sample.problems({})).toEqual([
      {
        severity: "error",
        rule: "contract/schema",
        file: PATH,
        message: "name Invalid input: expected string, received number",
      },
    ]);
  });

  it("names the root for a refusal of the body itself", () => {
    const sample = Sample.of({ path: PATH, body: { name: "a", extra: true } });

    expect(
      sample.problems({}).map((issue) => {
        return issue.message.startsWith("(root) ");
      }),
    ).toEqual([true]);
  });
});

describe("ConfigDocument.wireBody", () => {
  it("leaves out the editor's $schema pointer", () => {
    const sample = Sample.of({ path: PATH, body: { $schema: "../meta/sample.json", name: "a" } });

    expect(sample.wireBody(new MemoryStore())).toEqual({ name: "a" });
  });
});

describe("ConfigDocument.contractBody", () => {
  it("is the body without the editor's $schema pointer, which every rule judges", () => {
    const sample = Sample.of({ path: PATH, body: { $schema: "../meta/sample.json", name: "a" } });

    expect(sample.contractBody).toEqual({ name: "a" });
  });
});

describe("ConfigDocument edits", () => {
  it("refuse a region written by hand, naming the file and the region", () => {
    const sample = Sample.of({ path: PATH, body: { name: 7 } });

    const error = thrownBy(() => {
      return sample.withName("b");
    });

    expect(error).toEqual(
      expect.objectContaining({
        constructor: RefusedEditError,
        message: `${PATH}: name is not a string`,
        details: { file: PATH, region: "name is not a string" },
      }),
    );
  });

  it("leave the document they were given as it was", () => {
    const sample = Sample.of({ path: PATH, body: { name: "a" } });

    sample.withName("b");

    expect(sample.body).toEqual({ name: "a" });
  });
});
