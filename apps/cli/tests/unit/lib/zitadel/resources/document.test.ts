import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BrokenFilesError, RefusedEditError } from "@/lib/zitadel/errors";
import { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type ContractValue,
  type DocumentContract,
  type DocumentFile,
  type DocumentStatus,
} from "@/lib/zitadel/resources/document";
import type { Issue } from "@/lib/zitadel/rules/types";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * Where the document in these tests sits.
 */
const PATH = ".zitadel/samples/sample.json";

/**
 * The editor's pointer at the sample meta-schema.
 */
const POINTER = "../meta/sample.json";

/**
 * A sample whose name is a string.
 */
const NAMED = { path: PATH, body: { name: "a" } };

/**
 * The schema a sample is held to: a `name`, a string or a number, and
 * nothing else.
 */
const SAMPLE_SCHEMA = z.strictObject({ name: z.union([z.string(), z.number()]) });

/**
 * What a sample holds once its contract took its body.
 */
type SampleValue = ContractValue<typeof SAMPLE_SCHEMA>;

/**
 * The message the sample contract's explanation gives a body it refuses
 * because of its name.
 */
const NAME_EXPLAINED = "name must be a string or a number";

/**
 * The smallest document there is, built on nothing but what the base gives.
 */
class Sample extends ConfigDocument<SampleValue> {
  /**
   * The contract a sample is held to, under a rule borrowed for the test.
   */
  static readonly CONTRACT: DocumentContract<typeof SAMPLE_SCHEMA> = {
    kind: "schema",
    rule: "contract/schema",
    schema: SAMPLE_SCHEMA,
  };

  /**
   * The same contract, which words a refusal of the name its own way.
   */
  static readonly EXPLAINED: DocumentContract<typeof SAMPLE_SCHEMA> = {
    ...Sample.CONTRACT,
    explain: (_file, refusals) => {
      return refusals.map((refusal): Issue => {
        if (!refusal.message.startsWith("name ")) {
          return refusal;
        }
        return { ...refusal, message: NAME_EXPLAINED };
      });
    },
  };

  /**
   * What kind of document this is: a schema's kind, borrowed for the test.
   */
  readonly kind = "schema";

  /**
   * Hold a sample its contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile, value: SampleValue, status: DocumentStatus) {
    super(file, value, status);
  }

  /**
   * Read a sample file against a contract.
   *
   * @param file - The file.
   * @param contract - The contract; the plain one unless given.
   * @returns The sample, marked as read, or the broken file.
   */
  static read(
    file: DocumentFile,
    contract: DocumentContract<typeof SAMPLE_SCHEMA> = Sample.CONTRACT,
  ): Sample | BrokenFile {
    return Sample.readFile(contract, file, (value) => {
      return new Sample(file, value, "read");
    });
  }

  /**
   * Take a sample as read.
   *
   * @param file - The file.
   * @returns The sample, marked as read.
   * @throws {@link BrokenFilesError} When the contract refuses the body.
   */
  static of(file: DocumentFile): Sample {
    return new Sample(file, Sample.parseFile(Sample.CONTRACT, file), "read");
  }

  /**
   * A new sample, not yet written.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The sample, marked as created.
   * @throws {@link BrokenFilesError} When the contract refuses the body.
   */
  static create(file: DocumentFile): Sample {
    return new Sample(file, Sample.parseFile(Sample.CONTRACT, file), "created");
  }

  /**
   * The body without the editor's pointer.
   *
   * @param _store - Unused.
   * @returns The body.
   */
  toWireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The sample renamed.
   *
   * @param name - The new name.
   * @returns The edited sample.
   * @throws {@link RefusedEditError} When `name` is not a string.
   * @throws {@link BrokenFilesError} When the contract refuses the new name.
   */
  withName(name: JsonObject[string]): Sample {
    this.refuseUneditable(typeof this.value.name === "string" ? undefined : "name is not a string");
    const file = { path: this.path, body: { ...this.body, name } };
    return new Sample(file, Sample.parseFile(Sample.CONTRACT, file), this.editedStatus);
  }
}

describe("ConfigDocument.isUnsaved", () => {
  it("is false for a document as read", () => {
    const sample = Sample.of(NAMED);

    const changed = sample.isUnsaved;

    expect(changed).toBe(false);
  });

  it("is true once a document is edited", () => {
    const sample = Sample.of(NAMED);

    const changed = sample.withName("b").isUnsaved;

    expect(changed).toBe(true);
  });

  it("is true for a new document", () => {
    const sample = Sample.create(NAMED);

    const changed = sample.isUnsaved;

    expect(changed).toBe(true);
  });
});

describe("ConfigDocument.writeMode", () => {
  it("replaces the file of a document that was read", () => {
    const sample = Sample.of(NAMED);

    const mode = sample.writeMode;

    expect(mode).toBe("replace");
  });

  it("creates the file of a new document", () => {
    const sample = Sample.create(NAMED);

    const mode = sample.writeMode;

    expect(mode).toBe("create");
  });

  it("still creates the file of a new document after an edit", () => {
    const sample = Sample.create(NAMED);

    const mode = sample.withName("b").writeMode;

    expect(mode).toBe("create");
  });
});

describe("ConfigDocument.file", () => {
  it("gives the path and the body exactly as written", () => {
    const body = { $schema: POINTER, name: "a" };

    const file = Sample.of({ path: PATH, body }).file;

    expect(file).toEqual({ path: PATH, body });
  });
});

describe("ConfigDocument.check", () => {
  it("finds nothing for a kind with nothing to add to its contract", () => {
    const sample = Sample.of(NAMED);

    const problems = sample.check({});

    expect(problems).toEqual([]);
  });
});

describe("ConfigDocument.readFile", () => {
  it("makes a document of a body the contract takes once the editor's pointer is set aside", () => {
    const file = { path: PATH, body: { $schema: POINTER, name: "a" } };

    const reading = Sample.read(file);

    expect(reading).toBeInstanceOf(Sample);
  });

  it("holds what the contract parsed the body to", () => {
    const file = { path: PATH, body: { $schema: POINTER, name: "a" } };

    const reading = Sample.read(file);

    expect(reading).toMatchObject({ value: { name: "a" } });
  });

  it("makes a broken file of a body the contract refuses", () => {
    const file = { path: PATH, body: { name: true } };

    const reading = Sample.read(file);

    expect(reading).toBeInstanceOf(BrokenFile);
  });

  it("keeps the path, the kind and the body as written on a broken file", () => {
    const body = { $schema: POINTER, name: true };

    const reading = Sample.read({ path: PATH, body });

    expect(reading).toMatchObject({ path: PATH, kind: "schema", body });
  });

  it("reports each refusal with its path, as an error in the file", () => {
    const file = { path: PATH, body: { name: true } };

    const reading = Sample.read(file);

    expect(reading).toMatchObject({
      issues: [
        {
          severity: "error",
          rule: "contract/schema",
          file: PATH,
          message: expect.stringMatching(/^name Invalid input/),
        },
      ],
    });
  });

  it("names the root for a refusal of the body itself", () => {
    const file = { path: PATH, body: { name: "a", extra: true } };

    const reading = Sample.read(file);

    expect(reading).toMatchObject({ issues: [{ message: expect.stringMatching(/^\(root\) /) }] });
  });

  it("reports what the kind's explanation makes of the refusals", () => {
    const file = { path: PATH, body: { name: true } };

    const reading = Sample.read(file, Sample.EXPLAINED);

    expect(reading).toMatchObject({ issues: [{ message: NAME_EXPLAINED }] });
  });
});

describe("ConfigDocument.parseFile", () => {
  it("refuses a body the contract refuses, naming the file", () => {
    const file = { path: PATH, body: { name: true } };

    const error = thrownBy(() => {
      return Sample.of(file);
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
    expect(error).toMatchObject({ problems: [{ path: PATH }] });
  });
});

describe("ConfigDocument.toWireBody", () => {
  it("leaves out the editor's $schema pointer", () => {
    const sample = Sample.of({ path: PATH, body: { $schema: POINTER, name: "a" } });

    const body = sample.toWireBody(new MemoryStore());

    expect(body).toEqual({ name: "a" });
  });
});

describe("ConfigDocument.contractBody", () => {
  it("is the body without the editor's $schema pointer, which every rule judges", () => {
    const sample = Sample.of({ path: PATH, body: { $schema: POINTER, name: "a" } });

    const body = sample.contractBody;

    expect(body).toEqual({ name: "a" });
  });
});

describe("ConfigDocument edits", () => {
  it("refuse a region written by hand, naming the file and the region", () => {
    const sample = Sample.of({ path: PATH, body: { name: 7 } });

    const error = thrownBy(() => {
      return sample.withName("b");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      message: `${PATH}: name is not a string`,
      details: { file: PATH, region: "name is not a string" },
    });
  });

  it("parse the body they make, refusing one the contract refuses", () => {
    const sample = Sample.of(NAMED);

    const error = thrownBy(() => {
      return sample.withName(true);
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
  });

  it("hold what the contract parsed the new body to", () => {
    const sample = Sample.of(NAMED);

    const edited = sample.withName("b");

    expect(edited.value).toEqual({ name: "b" });
  });

  it("leave the document they were given as it was", () => {
    const sample = Sample.of(NAMED);

    sample.withName("b");

    expect(sample.body).toEqual({ name: "a" });
  });
});
