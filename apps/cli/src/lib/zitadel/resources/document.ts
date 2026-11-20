import type { ReadonlyDeep } from "type-fest";
import type { ZodType, z } from "zod";

import { BrokenFilesError, RefusedEditError } from "@/lib/zitadel/errors";
import { BrokenFile } from "@/lib/zitadel/resources/broken";
import type { Issue, RuleId, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore, WriteMode } from "@/lib/zitadel/storage/types";
import type { ConfigFile, JsonObject, UnparsedFile } from "@/lib/zitadel/types";
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
 */
export type DocumentFile = {
  /**
   * The project-relative path of the file.
   */
  readonly path: string;

  /**
   * The file's parsed body.
   */
  readonly body: JsonObject;
};

/**
 * A file as a store read it: one with a body, or one that could not be taken
 * as a JSON object and so has none.
 */
export type ReadableFile = DocumentFile | UnparsedFile;

/**
 * What a document of a kind holds once its contract took the body: the
 * contract's output, read-only all the way down.
 *
 * @typeParam Schema - The kind's zod contract.
 */
export type ContractValue<Schema extends ZodType> = ReadonlyDeep<z.output<Schema>>;

/**
 * The contract one kind of document is held to: the zod schema its body must
 * satisfy, the rule a refusal is reported under, and how the kind words a
 * file the schema refuses.
 *
 * @typeParam Schema - The zod schema, whose output a document of the kind holds.
 */
export type DocumentContract<Schema extends ZodType> = {
  /**
   * The kind of document the contract makes, which a broken file is filed as.
   */
  readonly kind: DocumentKind;

  /**
   * The rule a refusal is reported under, such as `contract/connection`.
   */
  readonly rule: RuleId;

  /**
   * The schema the body without its `$schema` pointer must satisfy.
   */
  readonly schema: Schema;

  /**
   * What the body as written breaks beyond the schema, each at its dotted path
   * (empty for the root), for a rule that must see keys the schema strips.
   *
   * @param body - The body without its `$schema` pointer.
   * @returns One refusal per problem; none when the body is sound.
   */
  readonly refuse?: (
    body: unknown,
  ) => readonly { readonly path: string; readonly message: string }[];

  /**
   * Every finding a file the schema refuses is broken by.
   *
   * @remarks
   * Absent for a kind that reports the refusals as they are. A kind that
   * words some of them its own way, or adds what a file of the kind must
   * never hold, says so here.
   *
   * @param file - The file the schema refused.
   * @param refusals - One finding per refusal, under {@link rule}.
   * @returns The findings; never none.
   */
  readonly explain?: (file: DocumentFile, refusals: readonly Issue[]) => readonly Issue[];
};

/**
 * A region an edit did not write as it would have, because it was changed by
 * hand: left alone entirely (`hand-edited`), or edited with the routes the
 * developer wrote kept as they are (`routes-kept`).
 */
export type SkippedRegion =
  | {
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

      /**
       * The fields the step would have been asked for, which the developer adds
       * by hand; left out when the step was left alone for another reason.
       */
      readonly fields?: readonly string[];
    }
  | {
      /**
       * The step that was edited, such as `identifier`.
       */
      readonly step: string;

      /**
       * Where in the file, such as `steps.identifier`.
       */
      readonly region: `steps.${string}`;

      /**
       * The step was edited, but routes the developer wrote were kept.
       */
      readonly reason: "routes-kept";

      /**
       * The outcomes whose routes were kept, such as `sso_authenticated`.
       */
      readonly routes: readonly string[];
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
 * One configuration file its contract took, as the library holds it: its
 * path, its body as read with every unknown key kept, the typed value its
 * contract parsed the body to, and where it stands against the file on disk.
 *
 * @remarks
 * A document only exists when its body passes its kind's contract: a file the
 * contract refuses is a {@link BrokenFile} instead. Every kind of document
 * follows the same standard:
 *
 * - it names its {@link DocumentContract} in a static `CONTRACT`, and its
 *   `Value` is that contract's {@link ContractValue};
 * - `static read(file)` sorts a file into a document or a {@link BrokenFile};
 *   `static of(file)` (read) and `static create(file)` (new) make a document of
 *   a body that must pass;
 * - a getter reads {@link value}; {@link body} is only what is written back;
 * - {@link check} says what else is wrong with the file on its own, beyond
 *   what its contract refuses;
 * - {@link toWireBody} gives the body the server receives;
 * - it names its {@link kind}, which the configuration files it under and
 *   which tells one kind of document from another;
 * - an edit is a `with…` or `without…` method that returns an {@link Edit}
 *   holding a new document, or the same one when there is nothing to change,
 *   and throws {@link RefusedEditError} when it cannot be made, or
 *   {@link BrokenFilesError} when the contract refuses the body it makes.
 *
 * Immutable. The body is never changed in place, so a document read once can
 * be compared with what an edit made of it. The body is kept whole, including
 * fields the library has no use for, so writing a document back loses nothing
 * its author put there. An edit builds a new document of the new body, which
 * its contract parses again.
 *
 * @typeParam Value - What the kind's contract parses the body to.
 */
export abstract class ConfigDocument<Value = unknown> {
  /**
   * Which kind of document this is, which the configuration files it under.
   */
  abstract readonly kind: DocumentKind;

  /**
   * The project-relative path of the file the document is saved to.
   */
  readonly path: string;

  /**
   * The body as read, including the editor-only `$schema` pointer and every key
   * the contract does not know. Keys are written back sorted, not in the order
   * the file had them.
   *
   * @remarks
   * Only for writing the file back: read what the document holds from
   * {@link value}.
   */
  readonly body: JsonObject;

  /**
   * What the kind's contract parsed {@link contractBody} to.
   */
  readonly value: Value;

  /**
   * Where the document stands against the file on disk.
   */
  readonly status: DocumentStatus;

  /**
   * Hold a body its contract took. Only a subclass's own factories call this,
   * with the value {@link parseFile} or {@link readFile} gave.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  protected constructor(file: DocumentFile, value: Value, status: DocumentStatus) {
    this.path = file.path;
    this.body = file.body;
    this.value = value;
    this.status = status;
  }

  /**
   * Read a file against its kind's contract: a document of the kind, or the
   * broken file it is.
   *
   * @remarks
   * The one place a body is parsed. A subclass's `read` passes how to make
   * its document of the value; `of`, `create` and every edit go through
   * {@link parseFile}, which is this with a refusal thrown.
   *
   * @typeParam Schema - The kind's zod contract.
   * @typeParam Document - The document the kind makes.
   * @param contract - The kind's contract.
   * @param file - The file as a store read it.
   * @param make - Make the document of what the contract parsed the body to,
   *   given the file it was parsed from, which has its body.
   * @returns The document, or the broken file with every finding its kind
   *   reports about it; a file that could not be parsed at all is broken with
   *   the one finding saying so, under the kind's contract rule.
   */
  protected static readFile<Schema extends ZodType, Document>(
    contract: DocumentContract<Schema>,
    file: ReadableFile,
    make: (value: z.output<Schema>, parsed: DocumentFile) => Document,
  ): Document | BrokenFile {
    if ("unparsed" in file) {
      // There is no body to hold to the contract, and the kind's own wording
      // of its refusals is about a body, so the one finding is reported as is.
      // A broken file always holds a body, so it holds an empty one here.
      return new BrokenFile({
        path: file.path,
        kind: contract.kind,
        body: {},
        issues: [
          ConfigDocument.makeFileIssue(
            file.path,
            contract.rule,
            `cannot be parsed: ${file.unparsed}`,
          ),
        ],
      });
    }
    const body = withoutKey(file.body, "$schema");
    const result = contract.schema.safeParse(body);
    const refused = contract.refuse?.(body) ?? [];
    if (result.success && refused.length === 0) {
      return make(result.data, file);
    }
    const parsed = result.success ? [] : result.error.issues;
    const refusals = [
      ...parsed.map((refusal) => {
        return { path: refusal.path.join("."), message: refusal.message };
      }),
      ...refused,
    ].map((refusal) => {
      const where = refusal.path || "(root)";
      return ConfigDocument.makeFileIssue(file.path, contract.rule, `${where} ${refusal.message}`);
    });
    const issues = contract.explain?.(file, refusals) ?? refusals;
    return new BrokenFile({ path: file.path, kind: contract.kind, body: file.body, issues });
  }

  /**
   * Parse a body that must pass its kind's contract: a new one, an edited
   * one, or one a caller already knows is sound.
   *
   * @typeParam Schema - The kind's zod contract.
   * @param contract - The kind's contract.
   * @param file - The file.
   * @returns What the contract parsed the body to.
   * @throws {@link BrokenFilesError} When the contract refuses the body,
   *   naming every finding its kind reports about it.
   */
  protected static parseFile<Schema extends ZodType>(
    contract: DocumentContract<Schema>,
    file: DocumentFile,
  ): z.output<Schema> {
    const reading = ConfigDocument.readFile(contract, file, (value) => {
      return { value };
    });
    if (reading instanceof BrokenFile) {
      throw new BrokenFilesError(reading.problems);
    }
    return reading.value;
  }

  /**
   * Make one error-level finding about a file.
   *
   * @param path - The project-relative path of the file.
   * @param rule - The rule it breaks.
   * @param message - What is wrong, and what to change.
   * @returns The finding.
   */
  protected static makeFileIssue(path: string, rule: RuleId, message: string): Issue {
    return { severity: "error", rule, file: path, message };
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
   * The body as its contract parsed it, and as the server receives it when
   * the kind has no references to inline.
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
   * Check this one file on its own, beyond what its contract refuses: what a
   * file of its kind must never hold even when its contract takes it.
   *
   * @remarks
   * What the contract refuses is never one of these: such a file is a
   * {@link BrokenFile}, not a document. A finding that needs other files,
   * such as a flow naming a schema that is not there, is never one of these
   * either. A check that needs what the context does not give is skipped. A
   * kind with nothing to add keeps this, which finds nothing.
   *
   * @param _context - What some checks need beyond the file, such as the store
   *   a `$file` reference is read from.
   * @returns Every finding, in the order the rules list them; none when the
   *   file is sound.
   */
  check(_context: ValidationContext): readonly Issue[] {
    return [];
  }

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
    return ConfigDocument.makeFileIssue(this.path, rule, message);
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
