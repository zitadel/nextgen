import type { FileProblem } from "@/lib/zitadel/errors";
import type { DocumentKind } from "@/lib/zitadel/resources/document";
import type { Issue } from "@/lib/zitadel/rules/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * What a broken file is made of: where it is, which kind of document it was
 * read as, what it holds, and why that is no document.
 */
export type BrokenFileFields = {
  /**
   * The project-relative path of the file.
   */
  readonly path: string;

  /**
   * The kind of document the file was read as, from the directory it is in.
   */
  readonly kind: DocumentKind;

  /**
   * The body exactly as written.
   */
  readonly body: JsonObject;

  /**
   * Every finding that makes the file broken, in the order its kind reports
   * them; never none.
   */
  readonly issues: readonly Issue[];
};

/**
 * A configuration file its kind's contract refuses, so it is no document: it
 * has no typed value, and no collection holds it.
 *
 * @remarks
 * Immutable. The configuration keeps every broken file it read beside its
 * collections, so a strict load can name each one and a caller that reports
 * everything in one pass, such as `deploy` or `doctor`, still sees them. The
 * findings are the ones the file's kind would report about it: the same rule
 * ids, messages and order as a document's own checks.
 */
export class BrokenFile {
  /**
   * The project-relative path of the file.
   */
  readonly path: string;

  /**
   * The kind of document the file was read as.
   */
  readonly kind: DocumentKind;

  /**
   * The body exactly as written.
   */
  readonly body: JsonObject;

  /**
   * Every finding that makes the file broken.
   */
  readonly issues: readonly Issue[];

  /**
   * Hold a file its contract refuses, and why.
   *
   * @param fields - The path, the kind, the body and the findings.
   */
  constructor(fields: BrokenFileFields) {
    this.path = fields.path;
    this.kind = fields.kind;
    this.body = fields.body;
    this.issues = fields.issues;
  }

  /**
   * The findings as a {@link BrokenFilesError} names them.
   *
   * @returns One problem per finding, each naming the file.
   */
  get problems(): readonly FileProblem[] {
    return this.issues.map((issue) => {
      return { path: this.path, problem: issue.message };
    });
  }
}
