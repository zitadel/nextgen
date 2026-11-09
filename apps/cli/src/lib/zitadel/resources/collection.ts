import { Change } from "@/lib/zitadel/change";
import type { AnyDocument, ZitadelConfig } from "@/lib/zitadel/config";

/**
 * The documents of one kind in a configuration, and the edits every kind
 * shares: reading one by path, adding or replacing one, and removing one.
 *
 * @remarks
 * Immutable, like the configuration that holds it. An edit returns a
 * {@link Change}, whose `after` holds the edited collection; this one is
 * never changed. A collection answers questions with its configuration in
 * reach, so a question that needs another kind of file is still asked here.
 *
 * @typeParam T - The kind of document.
 */
export class Collection<T extends AnyDocument> {
  /**
   * Every document of the kind, in the order the files were read and then
   * the order new ones were added.
   */
  readonly all: readonly T[];

  /**
   * The configuration the collection is part of, which every edit is made
   * on and every question that needs another kind of file reads.
   */
  protected readonly config: ZitadelConfig;

  /**
   * Hold the documents of one kind of a configuration.
   *
   * @param config - The configuration the collection is part of.
   * @param documents - Its documents.
   */
  constructor(config: ZitadelConfig, documents: readonly T[]) {
    this.config = config;
    this.all = documents;
  }

  /**
   * The project-relative paths of the documents, for a message to name them.
   *
   * @returns The paths, in the order of {@link all}.
   */
  get paths(): readonly string[] {
    return this.all.map((document) => {
      return document.path;
    });
  }

  /**
   * The documents of the collection that pass a test, as a collection of
   * their own, so a refusal can name them by {@link paths}.
   *
   * @param test - Whether a document belongs.
   * @returns The collection of those documents, in the same configuration.
   */
  where(test: (document: T) => boolean): Collection<T> {
    return new Collection(this.config, this.all.filter(test));
  }

  /**
   * The document at a path.
   *
   * @param path - The document's project-relative path.
   * @returns The document, or `undefined` when none of the kind is there.
   */
  get(path: string): T | undefined {
    return this.all.find((document) => {
      return document.path === path;
    });
  }

  /**
   * Add a document, or replace the one at its path.
   *
   * @param document - The new or edited document.
   * @returns The change.
   */
  put(document: T): Change {
    return new Change({ before: this.config, after: this.config.with(document) });
  }

  /**
   * Remove the document at a path, which saving the change deletes. A path
   * that holds no document of the kind changes nothing, so removing one
   * twice is not an error.
   *
   * @param path - The document's project-relative path.
   * @returns The change.
   */
  remove(path: string): Change {
    const document = this.get(path);
    if (document === undefined) {
      return new Change({ before: this.config, after: this.config });
    }
    return new Change({ before: this.config, after: this.config.without(document) });
  }
}
