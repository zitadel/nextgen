import { isDeepStrictEqual } from "node:util";

import { Change } from "@/lib/zitadel/change";
import type { AnyDocument, ZitadelConfig } from "@/lib/zitadel/config";
import type { DocumentFile } from "@/lib/zitadel/resources/document";
import type { ConfigDirectory, JsonObject } from "@/lib/zitadel/types";

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
   * Keep the documents of the collection that pass a test, as a collection of
   * their own, so a refusal can name them by {@link paths}.
   *
   * @param test - Whether a document belongs.
   * @returns The collection of those documents, in the same configuration.
   */
  filter(test: (document: T) => boolean): Collection<T> {
    return new Collection(this.config, this.all.filter(test));
  }

  /**
   * Get the document at a path.
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
   * Find the document a release pins by a handle.
   *
   * @remarks
   * Matched by what the document holds, never by its file name: setup writes
   * the human-user schema to `default-human-user.json`.
   *
   * @param handle - The handle.
   * @returns The first document that holds it, or `undefined` when none does.
   */
  findByHandle(handle: string): T | undefined {
    return this.all.find((document) => {
      return document.handle === handle;
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
   * Remove the document at a path, which saving the change deletes.
   *
   * @remarks
   * A path that holds no document of the kind changes nothing, so removing
   * one twice is not an error.
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

/**
 * A collection of a kind a release pins by handle, which `pull` rebuilds on
 * disk from the revisions a release pins.
 *
 * @typeParam T - The kind of document.
 */
export abstract class PinnedCollection<T extends AnyDocument> extends Collection<T> {
  /**
   * The directory a document of the kind goes in when no file holds its handle.
   */
  protected abstract readonly directory: ConfigDirectory;

  /**
   * Make a new document of the kind.
   *
   * @param file - Its path and body.
   * @returns The document.
   */
  protected abstract createDocument(file: DocumentFile): T;

  /**
   * Locate where a document a release pins by a handle goes: the file that
   * holds the handle, or `<handle>.json` when none does.
   *
   * @param handle - The handle.
   * @returns The project-relative path.
   */
  locate(handle: string): string {
    const holder = this.findByHandle(handle);
    if (holder !== undefined) {
      return holder.path;
    }
    return `${this.directory}/${handle}.json`;
  }

  /**
   * Place a revision a release pinned at {@link locate}, replacing whatever
   * file is there.
   *
   * @remarks
   * The server never echoes the editor-only `$schema` pointer, so the one in
   * the file there is carried over unless the revision has its own. A file
   * that already holds exactly this is left alone, so the change writes
   * nothing. The revision is written whole, as a new document, so saving the
   * change over a file already there takes `overwrite`.
   *
   * @param handle - The handle the release pins it by.
   * @param revision - The body as the server answered it.
   * @returns The change.
   */
  placeRevision(handle: string, revision: JsonObject): Change {
    const path = this.locate(handle);
    const there = this.get(path);
    const pointer = there?.body.$schema;
    const carried = typeof pointer === "string" && !("$schema" in revision);
    const body = carried ? { ...revision, $schema: pointer } : revision;
    if (there !== undefined && isDeepStrictEqual(there.body, body)) {
      return new Change({ before: this.config, after: this.config });
    }
    return this.put(this.createDocument({ path, body }));
  }
}
