import type { ZodType } from "zod";

import { RefusedEditError } from "@/lib/zitadel/errors";
import type { Issue, RuleId, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore, WriteMode } from "@/lib/zitadel/storage/types";
import type { ConfigFile, JsonObject } from "@/lib/zitadel/types";

/**
 * Where a document stands against the file it is saved to: as it was read,
 * edited since, or new and not yet written.
 */
export type DocumentStatus = "read" | "edited" | "created";

/**
 * A file a document is made from: its project-relative path and its body.
 *
 * @remarks
 * The body's type is kept, so a caller that holds a typed body gets a document
 * of that body back.
 */
export type DocumentFile<Body extends JsonObject = JsonObject> = Readonly<{
  /**
   * The project-relative path of the file.
   */
  path: string;
  /**
   * The file's parsed body.
   */
  body: Body;
}>;

/**
 * One configuration file, as the library holds it: its path, its body exactly
 * as written, and where it stands against the file on disk.
 *
 * @remarks
 * Every kind of document follows the same standard:
 *
 * - it is made with `static of(file)` when read and `static create(file)` when
 *   new, and {@link asRead} marks it saved;
 * - {@link problems} says everything wrong with the file on its own;
 * - {@link wireBody} gives the body the server receives;
 * - an edit is a `with…` or `without…` method that returns a new document, or
 *   the same one when there is nothing to change, and throws
 *   {@link RefusedEditError} when it cannot be made.
 *
 * Immutable. The body is never changed in place, so a document read once can
 * be compared with what an edit made of it. The body is kept whole, including
 * fields the library has no use for, so writing a document back loses nothing
 * its author put there.
 */
export abstract class ConfigDocument<Body extends JsonObject = JsonObject> {
  /**
   * The project-relative path of the file the document is saved to.
   */
  readonly path: string;

  /**
   * The body exactly as written, including the editor-only `$schema` pointer.
   */
  readonly body: Body;

  /**
   * Where the document stands against the file on disk.
   */
  readonly status: DocumentStatus;

  /**
   * Hold a body at a path. Only a subclass's own `of` and `create` call this.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  protected constructor(path: string, body: Body, status: DocumentStatus) {
    this.path = path;
    this.body = body;
    this.status = status;
  }

  /**
   * Whether the document differs from the file on disk.
   *
   * @returns True once it has been edited, or while it is new and unwritten.
   */
  get changed(): boolean {
    return this.status !== "read";
  }

  /**
   * How saving the document writes its file.
   *
   * @remarks
   * A new document never replaces a file already there.
   *
   * @returns `create` for a new document, `replace` for one that was read.
   */
  get writeMode(): WriteMode {
    if (this.status === "created") {
      return "create";
    }
    return "replace";
  }

  /**
   * The document as a file to write.
   *
   * @returns Its path and body.
   */
  toFile(): ConfigFile {
    return { path: this.path, body: this.body };
  }

  /**
   * The document as saved: what it holds is now what the file holds.
   *
   * @returns The same document, marked as read.
   */
  abstract asRead(): ConfigDocument<Body>;

  /**
   * Everything wrong with this one file on its own: what its kind's contract
   * refuses, and what a file of its kind must never hold.
   *
   * @remarks
   * A finding that needs other files, such as a flow naming a schema that is
   * not there, is never one of these. A check that needs what the context does
   * not give is skipped.
   *
   * @param context - What some checks need beyond the file, such as the store
   *   a `$file` reference is read from.
   * @returns Every finding, in the order the rules list them; none when the
   *   file is sound.
   */
  abstract problems(context: ValidationContext): readonly Issue[];

  /**
   * The body the server receives for this file.
   *
   * @remarks
   * Never the editor-only `$schema` pointer, and every `$file` reference
   * inlined for a kind that has them.
   *
   * @param store - Where referenced files are read from.
   * @returns The body to send.
   */
  abstract wireBody(store: ConfigStore): JsonObject;

  /**
   * The status an edit leaves a document in.
   *
   * @remarks
   * A new document stays new, so saving it still never replaces a file.
   *
   * @returns `created` for a new document, `edited` for one that was read.
   */
  protected get editedStatus(): DocumentStatus {
    if (this.status === "created") {
      return "created";
    }
    return "edited";
  }

  /**
   * The body as its contract judges it, and as the server receives it when
   * the kind has no references to inline.
   *
   * @returns The body without the editor-only `$schema` pointer.
   */
  protected get contractBody(): JsonObject {
    const { $schema: _editorOnly, ...body } = this.body;
    return body;
  }

  /**
   * One error-level finding about this file.
   *
   * @param rule - The rule it breaks.
   * @param message - What is wrong, and what to change.
   * @returns The finding.
   */
  protected issue(rule: RuleId, message: string): Issue {
    return { severity: "error", rule, file: this.path, message };
  }

  /**
   * What a contract refuses in this file, one finding per refusal.
   *
   * @param rule - The rule that holds the file to the contract.
   * @param contract - The contract.
   * @returns The findings; none when the contract takes the file.
   */
  protected contractIssues(rule: RuleId, contract: ZodType): readonly Issue[] {
    const result = contract.safeParse(this.contractBody);
    if (result.success) {
      return [];
    }
    return result.error.issues.map((refusal) => {
      return this.issue(rule, `${refusal.path.join(".") || "(root)"} ${refusal.message}`);
    });
  }

  /**
   * Refuse an edit to a region that is not the shape the edit writes.
   *
   * @remarks
   * Such a region was written by hand, and rewriting it would discard it.
   *
   * @param region - What is wrong with the region, or `undefined` when nothing is.
   * @throws {@link RefusedEditError} When a region is named, with the file and
   *   the region.
   */
  protected refuseUneditable(region: string | undefined): void {
    if (region === undefined) {
      return;
    }
    throw new RefusedEditError(`${this.path}: ${region}`, {
      hint:
        "This command edits that region, and it is not the shape it edits. " +
        "Fix it against the dialect in .zitadel/meta/, then run the command again.",
      details: { file: this.path, region },
    });
  }
}
