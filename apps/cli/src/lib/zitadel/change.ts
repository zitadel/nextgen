import type { AnyDocument, ZitadelConfig } from "@/lib/zitadel/config";
import { FileExistsError } from "@/lib/zitadel/errors";
import type { ConfigStore, WriteMode } from "@/lib/zitadel/storage/types";
import type { ConfigFile } from "@/lib/zitadel/types";

/**
 * Every way a caller reports a notice: a warning for something to act on, info
 * for something to know.
 */
export const NOTICE_SEVERITIES = ["warning", "info"] as const;

/**
 * How a caller reports a notice.
 */
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

/**
 * Something a caller should tell the person about a change: left alone,
 * kept, or still to do.
 */
export type Notice = {
  /**
   * How the caller should report it.
   */
  readonly severity: NoticeSeverity;

  /**
   * What to tell the person, as a sentence they can act on.
   */
  readonly message: string;
};

/**
 * A plain-text file a change writes beside the documents, such as a branding
 * template.
 */
type TextFile = {
  /**
   * The project-relative path.
   */
  readonly path: string;

  /**
   * What the file holds.
   */
  readonly text: string;
};

/**
 * A JSON file a change writes as given, without the contract of any kind
 * having taken it, such as a revision a release pinned.
 */
export type WrittenFile = ConfigFile & {
  /**
   * Whether the file replaces one already there, so it counts as edited
   * rather than created.
   */
  readonly replaces: boolean;
};

/**
 * What saving does about a new file that is already on disk.
 */
export type SaveOptions = {
  /**
   * Replace it instead of refusing, as `--force` asks.
   */
  readonly overwrite?: boolean;

  /**
   * Which documents are only ever created, even when `overwrite` is set: a
   * taken path refuses, whether or not the document was read. All of them may be replaced when left out.
   */
  readonly createOnly?: (document: AnyDocument) => boolean;
};

/**
 * One file write, waiting for its turn.
 */
type PendingWrite = {
  /**
   * The project-relative path.
   */
  readonly path: string;

  /**
   * Whether it creates the file or replaces it.
   */
  readonly mode: WriteMode;

  /**
   * Write it.
   */
  readonly run: () => Promise<void>;
};

/**
 * What a {@link Change} is made of.
 */
export type ChangeInput = {
  /**
   * The configuration the edit was made on.
   */
  readonly before: ZitadelConfig;

  /**
   * The configuration as the edit leaves it.
   */
  readonly after: ZitadelConfig;

  /**
   * What to say about the change; nothing when left out.
   */
  readonly notices?: readonly Notice[];

  /**
   * The text files it writes beside the documents; none when left out.
   */
  readonly texts?: readonly TextFile[];

  /**
   * The JSON files it writes as given, beside the documents; none when left
   * out.
   */
  readonly files?: readonly WrittenFile[];
};

/**
 * One edit to the configuration: the configuration before and after, the
 * files it writes and deletes, and what the caller should be told about it.
 *
 * @remarks
 * Every edit returns one, whatever it edits: a collection's `put` and
 * `remove` for a single document, and operations such as
 * `config.connections.enable` that edit several files together. An operation
 * refuses, with a {@link ConfigError}, anything it cannot do, so a change that
 * exists is one that can be written. Nothing is written until {@link save}.
 */
export class Change {
  /**
   * The configuration the edit was made on.
   */
  readonly before: ZitadelConfig;

  /**
   * The configuration as the edit leaves it.
   */
  readonly after: ZitadelConfig;

  /**
   * What the caller should tell the person: what was left alone, kept, or
   * still needs doing.
   */
  readonly notices: readonly Notice[];

  /**
   * The plain-text files the change writes beside the documents.
   */
  private readonly texts: readonly TextFile[];

  /**
   * The JSON files the change writes as given, beside the documents.
   */
  private readonly files: readonly WrittenFile[];

  /**
   * Describe an edit that has been made in memory and not yet written.
   *
   * @param input - The configuration before and after, what to say about the
   *   change, and any text files it writes beside the documents.
   */
  constructor(input: ChangeInput) {
    this.before = input.before;
    this.after = input.after;
    this.notices = input.notices ?? [];
    this.texts = input.texts ?? [];
    this.files = input.files ?? [];
  }

  /**
   * The files the change writes.
   *
   * @returns Their project-relative paths, documents first.
   */
  get changedPaths(): readonly string[] {
    return this.pathsWithTexts(this.after.changedDocuments, this.files);
  }

  /**
   * The files the change creates, which were not there before.
   *
   * @returns Their project-relative paths, documents first.
   */
  get createdPaths(): readonly string[] {
    const created = this.after.changedDocuments.filter((document) => {
      return document.status === "created";
    });
    return this.pathsWithTexts(
      created,
      this.files.filter((file) => {
        return !file.replaces;
      }),
    );
  }

  /**
   * The files the change deletes: those removed in the configuration after
   * it that were not already removed in the configuration before it.
   *
   * @returns Their project-relative paths, in the order they were read.
   */
  get removedPaths(): readonly string[] {
    const already = new Set(
      this.before.removedDocuments.map((document) => {
        return document.path;
      }),
    );
    return this.after.removedDocuments
      .map((document) => {
        return document.path;
      })
      .filter((path) => {
        return !already.has(path);
      });
  }

  /**
   * Whether the change writes or deletes anything.
   *
   * @returns True when saving it touches a file.
   */
  get changed(): boolean {
    return this.changedPaths.length > 0 || this.removedPaths.length > 0;
  }

  /**
   * The same change, also writing a new text file, such as the template a
   * branding descriptor references.
   *
   * @param path - The project-relative path.
   * @param text - What the file holds.
   * @returns The change.
   */
  withText(path: string, text: string): Change {
    return new Change({
      before: this.before,
      after: this.after,
      notices: this.notices,
      texts: [...this.texts, { path, text }],
      files: this.files,
    });
  }

  /**
   * Write what the change edits, then delete what it removes.
   *
   * @remarks
   * Every write that creates a file, a document or a text, goes first, so one
   * that is already on disk refuses the write before any file is replaced or
   * deleted; deletions go last, so a write that
   * fails leaves every file that was there. One file at a time, in that order.
   *
   * @param store - Where the configuration is kept.
   * @param options - Whether a new file may replace one already there, and
   *   which documents never may.
   * @returns The paths written, not those deleted, which
   *   {@link Change.removedPaths} lists.
   * @throws {@link FileExistsError} When a new file is already on disk and
   *   may not be replaced.
   * @throws {@link ConfigError} When any path to write or delete leads
   *   outside `.zitadel/`; nothing is written or deleted then.
   */
  async save(store: ConfigStore, options: SaveOptions = {}): Promise<readonly string[]> {
    const writes = await this.verified(store, options);
    for (const write of writes) {
      await write.run();
    }
    for (const path of this.removedPaths) {
      await store.remove(path);
    }
    return this.changedPaths;
  }

  /**
   * Run the checks {@link save} makes before it touches a file, and write and
   * delete nothing.
   *
   * @remarks
   * For a caller that does something irreversible before it saves, such as
   * publishing a credential, so a refusal {@link save} would make comes first.
   * It is exactly the checks {@link save} runs, so a change this accepts is one
   * {@link save} does not refuse, unless the disk changes in between.
   *
   * @param store - Where the configuration is kept.
   * @param options - Whether a new file may replace one already there, and
   *   which documents never may.
   * @throws {@link FileExistsError} When a new file is already on disk and
   *   may not be replaced.
   * @throws {@link ConfigError} When any path to write or delete leads
   *   outside `.zitadel/`.
   */
  async check(store: ConfigStore, options: SaveOptions = {}): Promise<void> {
    await this.verified(store, options);
  }

  /**
   * The writes the change makes, in the order they are made, once every check
   * that could refuse them has passed.
   *
   * @param store - Where the configuration is kept.
   * @param options - Whether a new file may replace one already there, and
   *   which documents never may.
   * @returns The writes, creating ones first.
   * @throws {@link FileExistsError} When a new file is already on disk and
   *   may not be replaced.
   * @throws {@link ConfigError} When any path to write or delete leads
   *   outside `.zitadel/`.
   */
  private async verified(
    store: ConfigStore,
    options: SaveOptions,
  ): Promise<readonly PendingWrite[]> {
    const overwrite = options.overwrite === true;
    const keepsCreating = options.createOnly;
    const held = this.heldPaths;
    const documents = this.after.changedDocuments.map((document): PendingWrite => {
      const mode = this.modeOf(document, overwrite, keepsCreating, held);
      return {
        path: document.path,
        mode,
        run: async (): Promise<void> => {
          await store.write(document.file, mode);
        },
      };
    });
    const textMode: WriteMode = overwrite ? "replace" : "create";
    const texts = this.texts.map((file): PendingWrite => {
      return {
        path: file.path,
        mode: textMode,
        run: async (): Promise<void> => {
          await store.writeText(file.path, file.text, textMode);
        },
      };
    });
    const files = this.files.map((file): PendingWrite => {
      const mode: WriteMode = overwrite || file.replaces ? "replace" : "create";
      return {
        path: file.path,
        mode,
        run: async (): Promise<void> => {
          await store.write({ path: file.path, body: file.body }, mode);
        },
      };
    });
    // A copy, so sorting it changes nothing the configuration holds. The sort
    // is stable, so create-mode writes keep their order, and so do the rest.
    const writes = [...documents, ...files, ...texts].sort((a, b) => {
      return Number(b.mode === "create") - Number(a.mode === "create");
    });
    // Every path is checked to be inside `.zitadel/` before any is written or
    // removed, so a path that escapes refuses with nothing touched.
    for (const write of writes) {
      store.assertWritable(write.path);
    }
    for (const path of this.removedPaths) {
      store.assertRemovable(path);
    }
    // Every file to create is checked before any is written, so a taken path
    // refuses with nothing touched, not after the files before it.
    for (const write of writes) {
      if (write.mode === "create" && (await store.exists(write.path))) {
        throw new FileExistsError(write.path);
      }
    }
    return writes;
  }

  /**
   * How a document's file is written.
   *
   * @param document - The document.
   * @param overwrite - Whether a new file may replace one already there.
   * @param createOnly - Which documents never may, if any.
   * @param held - The paths the configuration before the change held a file
   *   at.
   * @returns `create` for a document that never replaces a file, `replace`
   *   under overwrite or for a document put over a file the change was made
   *   on, and otherwise the document's own mode.
   */
  private modeOf(
    document: AnyDocument,
    overwrite: boolean,
    createOnly: SaveOptions["createOnly"],
    held: ReadonlySet<string>,
  ): WriteMode {
    if (createOnly !== undefined && createOnly(document)) {
      return "create";
    }
    if (overwrite || held.has(document.path)) {
      return "replace";
    }
    return document.writeMode;
  }

  /**
   * The paths the configuration the change was made on held a file at: a
   * document read from disk, a broken file, or one removed earlier in the
   * same edit.
   *
   * @remarks
   * Writing a new document at one of them is a replacement the edit meant,
   * not a file that appeared meanwhile; a path nothing held stays
   * create-only, so a file that turned up on disk since is still refused.
   *
   * @returns The project-relative paths.
   */
  private get heldPaths(): ReadonlySet<string> {
    const before = this.before;
    const documents: readonly AnyDocument[] = [
      ...before.schemas.all,
      ...before.flows.all,
      ...before.connections.all,
      ...before.policies.all,
      ...before.policies.tests,
      ...before.branding.all,
    ];
    const read = documents.filter((document) => {
      return document.status !== "created";
    });
    return new Set(
      [...read, ...before.broken, ...before.removedDocuments].map((file) => {
        return file.path;
      }),
    );
  }

  /**
   * The paths of some of the documents the change writes, then of some of its
   * JSON files, then of every text file it writes, which is always new.
   *
   * @param documents - The documents.
   * @param files - The JSON files.
   * @returns Their project-relative paths, documents first.
   */
  private pathsWithTexts(
    documents: readonly AnyDocument[],
    files: readonly WrittenFile[],
  ): readonly string[] {
    return [...documents, ...files, ...this.texts].map((file) => {
      return file.path;
    });
  }
}

/**
 * A change made about one document, such as the connection
 * `config.connections.enable` offers, which says what became of it.
 *
 * @typeParam T - The kind of document.
 */
export class DocumentChange<T extends AnyDocument> extends Change {
  /**
   * The document the change is about, as the change leaves it.
   */
  readonly document: T;

  /**
   * Describe an edit about one document.
   *
   * @param input - What a {@link Change} is made of, and the document it is
   *   about.
   */
  constructor(input: ChangeInput & { readonly document: T }) {
    super(input);
    this.document = input.document;
  }

  /**
   * Whether the change creates the document, rather than finding it already
   * there.
   *
   * @returns True when saving the change writes the document's file anew.
   */
  get created(): boolean {
    return this.createdPaths.includes(this.document.path);
  }
}
