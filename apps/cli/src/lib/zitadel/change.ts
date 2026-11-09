import type { AnyDocument, ZitadelConfig } from "@/lib/zitadel/config";
import type { ConfigStore, WriteMode } from "@/lib/zitadel/storage/types";

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
 * What saving does about a new file that is already on disk.
 */
export type SaveOptions = {
  /**
   * Replace it instead of refusing, as `--force` asks.
   */
  readonly overwrite?: boolean;
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
  }

  /**
   * The files the change writes.
   *
   * @returns Their project-relative paths, documents first.
   */
  get changedPaths(): readonly string[] {
    return this.pathsWithTexts(this.after.changedDocuments);
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
    return this.pathsWithTexts(created);
  }

  /**
   * The files the change deletes.
   *
   * @returns Their project-relative paths, in the order they were removed.
   */
  get removedPaths(): readonly string[] {
    return this.after.removedDocuments.map((document) => {
      return document.path;
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
    });
  }

  /**
   * Write what the change edits, then delete what it removes.
   *
   * @remarks
   * New files go first, so one that is already on disk refuses the write
   * before any other file is touched; deletions go last, so a write that
   * fails leaves every file that was there. One file at a time, in that order.
   *
   * @param store - Where the configuration is kept.
   * @param options - Whether a new file may replace one already there.
   * @returns The paths written, not those deleted.
   * @throws {@link FileExistsError} When a new file is already on disk and
   *   may not be replaced.
   */
  async save(store: ConfigStore, options: SaveOptions = {}): Promise<readonly string[]> {
    const overwrite = options.overwrite === true;
    // A copy, so sorting it changes nothing the configuration holds.
    const documents = [...this.after.changedDocuments].sort((a, b) => {
      return Number(b.status === "created") - Number(a.status === "created");
    });
    for (const document of documents) {
      const mode: WriteMode = overwrite ? "replace" : document.writeMode;
      await store.write(document.file, mode);
    }
    const textMode: WriteMode = overwrite ? "replace" : "create";
    for (const file of this.texts) {
      await store.writeText(file.path, file.text, textMode);
    }
    for (const path of this.removedPaths) {
      await store.remove(path);
    }
    return this.changedPaths;
  }

  /**
   * The paths of some of the documents the change writes, then of every text
   * file it writes, which is always new.
   *
   * @param documents - The documents.
   * @returns Their project-relative paths, documents first.
   */
  private pathsWithTexts(documents: readonly AnyDocument[]): readonly string[] {
    return [...documents, ...this.texts].map((file) => {
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
