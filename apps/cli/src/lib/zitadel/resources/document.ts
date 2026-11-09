import type { ZodType } from "zod";

import { RefusedEditError } from "@/lib/zitadel/errors";
import type { Issue, RuleId, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore, WriteMode } from "@/lib/zitadel/storage/types";
import type { ConfigFile, JsonObject } from "@/lib/zitadel/types";
import { withoutKey } from "@/lib/zitadel/utils/json";

/**
 * Every way a document can stand against the file it is saved to: as it was
 * read, edited since, or new and not yet written.
 */
export const DOCUMENT_STATUSES = ["read", "edited", "created"] as const;

/**
 * Where a document stands against the file it is saved to.
 */
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Every kind of document the configuration holds, which it files each under.
 */
export const DOCUMENT_KINDS = [
  "schema",
  "flow",
  "connection",
  "policy",
  "policy-test",
  "branding",
] as const;

/**
 * Which kind of document one is.
 */
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * A file a document is made from: its project-relative path and its body.
 *
 * @remarks
 * The body's type is kept, so a caller that holds a typed body gets a document
 * of that body back.
 *
 * @typeParam Body - The body's type.
 */
export type DocumentFile<Body extends JsonObject = JsonObject> = {
  /**
   * The project-relative path of the file.
   */
  readonly path: string;

  /**
   * The file's parsed body.
   */
  readonly body: Body;
};

/**
 * A region an edit left alone because it was changed by hand.
 */
export type SkippedRegion = {
  /**
   * The step that was left alone, such as `sso-conflict`.
   */
  readonly step: string;

  /**
   * Where in the file, such as `steps.sso-conflict`.
   */
  readonly region: `steps.${string}`;

  /**
   * Why it was left alone.
   */
  readonly reason: "hand-edited";
};

/**
 * What an edit made of a document: every `with…` and `without…` returns one.
 *
 * @remarks
 * An edit that changes nothing hands back the document it was given, so a
 * rerun is a no-op; what it left alone is said either way.
 *
 * @typeParam Document - What was edited.
 */
export type Edit<Document> = {
  /**
   * The document as the edit leaves it: a new one, or the same one when
   * nothing changed.
   */
  readonly document: Document;

  /**
   * False when the edit changed nothing.
   */
  readonly changed: boolean;

  /**
   * The regions the edit left alone because they were changed by hand.
   */
  readonly skipped: readonly SkippedRegion[];
};

/**
 * One configuration file, as the library holds it: its path, its body exactly
 * as written, and where it stands against the file on disk.
 *
 * @remarks
 * Every kind of document follows the same standard:
 *
 * - it is made with `static of(file)` when read and `static create(file)` when
 *   new, and {@link markRead} marks it saved;
 * - {@link check} says everything wrong with the file on its own;
 * - {@link toWireBody} gives the body the server receives;
 * - it names its {@link kind}, which the configuration files it under and
 *   which tells one kind of document from another;
 * - an edit is a `with…` or `without…` method that returns an {@link Edit}
 *   holding a new document, or the same one when there is nothing to change,
 *   and throws {@link RefusedEditError} when it cannot be made.
 *
 * Immutable. The body is never changed in place, so a document read once can
 * be compared with what an edit made of it. The body is kept whole, including
 * fields the library has no use for, so writing a document back loses nothing
 * its author put there.
 *
 * @typeParam Body - The body's type.
 */
export abstract class ConfigDocument<Body extends JsonObject = JsonObject> {
  /**
   * Which kind of document this is, which the configuration files it under.
   */
  abstract readonly kind: DocumentKind;

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
  get isUnsaved(): boolean {
    return this.status !== "read";
  }

  /**
   * The name a release pins the document by.
   *
   * @remarks
   * A kind a release pins by name overrides this; any other kind has none.
   *
   * @returns The handle, or `undefined` when the document has none.
   */
  get handle(): string | undefined {
    return undefined;
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
  get file(): ConfigFile {
    return { path: this.path, body: this.body };
  }

  /**
   * The body as its contract and every rule judges it, and as the server
   * receives it when the kind has no references to inline.
   *
   * @returns The body without the editor-only `$schema` pointer.
   */
  get contractBody(): JsonObject {
    return withoutKey(this.body, "$schema");
  }

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
   * The document as saved: what it holds is now what the file holds.
   *
   * @returns The same document, marked as read.
   */
  abstract markRead(): ConfigDocument<Body>;

  /**
   * Check this one file on its own: what its kind's contract refuses, and what
   * a file of its kind must never hold.
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
  abstract check(context: ValidationContext): readonly Issue[];

  /**
   * Build the body the server receives for this file.
   *
   * @remarks
   * Never the editor-only `$schema` pointer, and every `$file` reference
   * inlined for a kind that has them.
   *
   * @param store - Where referenced files are read from.
   * @returns The body to send.
   * @throws {@link ConfigError} When a referenced file cannot be read.
   */
  abstract toWireBody(store: ConfigStore): JsonObject;

  /**
   * Make one error-level finding about this file.
   *
   * @param rule - The rule it breaks.
   * @param message - What is wrong, and what to change.
   * @returns The finding.
   */
  protected makeIssue(rule: RuleId, message: string): Issue {
    return { severity: "error", rule, file: this.path, message };
  }

  /**
   * Check this file against a contract, one finding per refusal.
   *
   * @param rule - The rule that holds the file to the contract.
   * @param contract - The contract.
   * @returns The findings; none when the contract takes the file.
   */
  protected checkContract(rule: RuleId, contract: ZodType): readonly Issue[] {
    const result = contract.safeParse(this.contractBody);
    if (result.success) {
      return [];
    }
    return result.error.issues.map((refusal) => {
      const where = refusal.path.join(".") || "(root)";
      return this.makeIssue(rule, `${where} ${refusal.message}`);
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
