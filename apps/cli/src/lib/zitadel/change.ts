import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { ConfigStore, Notice } from "@/lib/zitadel/types";

/** A plain-text file a change writes beside the documents, such as a branding template. */
type TextFile = Readonly<{ path: string; text: string }>;

/** What saving does about a new file that is already on disk. */
export type SaveOptions = Readonly<{
  /** Replace it instead of refusing, as `--force` asks. */
  overwrite?: boolean;
}>;

/**
 * One edit to the configuration: the configuration before and after, the
 * files it writes, and what the caller should be told about it.
 *
 * @remarks
 * Every edit returns one, whatever it edits: {@link ZitadelConfig.put} for a
 * single document, and the operations such as {@link ZitadelConfig.enableSso}
 * that edit several files together. An operation refuses, with a
 * {@link ConfigError}, anything it cannot do, so a change that exists is one
 * that can be written. Nothing is written until {@link save}.
 */
export class Change {
  readonly before: ZitadelConfig;
  readonly after: ZitadelConfig;
  /** What the caller should tell the person: what was left alone, kept, or still needs doing. */
  readonly notices: readonly Notice[];
  private readonly texts: readonly TextFile[];

  /**
   * @param input - The configuration before and after, what to say about the
   *   change, and any text files it writes beside the documents.
   */
  constructor(
    input: Readonly<{
      before: ZitadelConfig;
      after: ZitadelConfig;
      notices?: readonly Notice[];
      texts?: readonly TextFile[];
    }>,
  ) {
    this.before = input.before;
    this.after = input.after;
    this.notices = input.notices ?? [];
    this.texts = input.texts ?? [];
  }

  /** The files the change writes. */
  get changedPaths(): readonly string[] {
    const documents = this.after.changedDocuments.map((document) => {
      return document.path;
    });
    const texts = this.texts.map((file) => {
      return file.path;
    });
    return [...documents, ...texts];
  }

  /** The files the change creates, which were not there before. */
  get createdPaths(): readonly string[] {
    const documents = this.after.changedDocuments
      .filter((document) => {
        return document.status === "created";
      })
      .map((document) => {
        return document.path;
      });
    const texts = this.texts.map((file) => {
      return file.path;
    });
    return [...documents, ...texts];
  }

  /** Whether the change writes anything. */
  get changed(): boolean {
    return this.changedPaths.length > 0;
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
   * Write what the change edits. New files go first, so one that is already
   * on disk refuses the write before any other file is touched.
   *
   * @param store - Where the configuration is kept.
   * @param options - Whether a new file may replace one already there.
   * @returns The paths written.
   * @throws {@link FileExistsError} When a new file is already on disk and
   *   may not be replaced.
   */
  async save(store: ConfigStore, options: SaveOptions = {}): Promise<readonly string[]> {
    const documents = [...this.after.changedDocuments].sort((a, b) => {
      return Number(b.status === "created") - Number(a.status === "created");
    });
    for (const document of documents) {
      if (options.overwrite === true) {
        await store.write(document.toFile(), "replace");
      } else {
        await store.write(document.toFile(), document.writeMode);
      }
    }
    for (const file of this.texts) {
      if (options.overwrite === true) {
        await store.writeText(file.path, file.text, "replace");
      } else {
        await store.writeText(file.path, file.text, "create");
      }
    }
    return this.changedPaths;
  }
}
