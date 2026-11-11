import { isDeepStrictEqual } from "node:util";
import { renderList } from "@/lib/terminal-text";

import { Change } from "@/lib/zitadel/change";
import type { AnyDocument, ZitadelConfig } from "@/lib/zitadel/config";
import { ConflictError, InvalidHandleError } from "@/lib/zitadel/errors";
import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import type { DocumentKind } from "@/lib/zitadel/resources/document";
import { CONFIG_DIRECTORIES, type ConfigDirectory, type JsonObject } from "@/lib/zitadel/types";

/**
 * Where a file of a kind a release pins by handle keeps the handle in its raw
 * body, so a file its contract refuses can still be found by it.
 */
type HandleField = {
  /**
   * The kind of document a file there is read as.
   */
  readonly kind: DocumentKind;

  /**
   * The key of the raw body that holds the handle.
   */
  readonly key: string;
};

/**
 * A handle that is one path segment: not empty, and without a slash, a
 * backslash or a NUL.
 */
const SAFE_HANDLE = /^[^/\\\0]+$/;

/**
 * The handle field of each directory a release pins documents of: a schema's
 * `objectType` and a flow's `name`.
 */
const HANDLE_FIELDS: Readonly<Partial<Record<ConfigDirectory, HandleField>>> = {
  [CONFIG_DIRECTORIES.schemas]: { kind: "schema", key: "objectType" },
  [CONFIG_DIRECTORIES.flows]: { kind: "flow", key: "name" },
};

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
export abstract class Collection<T extends AnyDocument> {
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
   * The kinds of file the collection owns, which bound the broken files it
   * may read or delete.
   */
  abstract readonly kinds: readonly DocumentKind[];

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
   * Find the broken file at a path, when it is of a kind the collection owns.
   *
   * @remarks
   * A broken file of another kind at the path is none of the collection's
   * business: a schemas collection never reads or deletes a connection.
   *
   * @param path - The project-relative path.
   * @returns The broken file, or `undefined` when none of the collection's
   *   kinds is there.
   */
  protected findOwnBroken(path: string): BrokenFile | undefined {
    const broken = this.config.findBroken(path);
    if (broken === undefined || !this.kinds.includes(broken.kind)) {
      return undefined;
    }
    return broken;
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
    return new Subset(this.config, this.all.filter(test), this.kinds);
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
   * Add a document, or replace the one at its path.
   *
   * @remarks
   * Saving writes a new document over the file the configuration held at its
   * path, or had removed; a path nothing held stays create-only, so a file
   * that appeared on disk meanwhile is refused.
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
   * A broken file of the collection's own kind at the path is removed too,
   * since it stands in the way just as a document does; one of another kind
   * is left alone. A path that holds neither changes nothing, so
   * removing one twice is not an error.
   *
   * @param path - The document's project-relative path.
   * @returns The change.
   */
  remove(path: string): Change {
    const document = this.get(path);
    if (document !== undefined) {
      return new Change({ before: this.config, after: this.config.without(document) });
    }
    const broken = this.findOwnBroken(path);
    if (broken !== undefined) {
      return new Change({ before: this.config, after: this.config.withoutBroken(broken) });
    }
    return new Change({ before: this.config, after: this.config });
  }
}

/**
 * A document of a kind a release pins by handle.
 */
type Pinned = AnyDocument & {
  /**
   * The name a release pins the document by.
   */
  readonly handle: string | undefined;
};

/**
 * A collection of a kind a release pins by handle, which `pull` rebuilds on
 * disk from the revisions a release pins.
 *
 * @typeParam T - The kind of document.
 */
export abstract class PinnedCollection<T extends Pinned> extends Collection<T> {
  /**
   * The directory a document of the kind goes in when no file holds its handle.
   */
  protected abstract readonly directory: ConfigDirectory;

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
   * Locate where a document a release pins by a handle goes: the file that
   * holds the handle, or `<handle>.json` when none does.
   *
   * @remarks
   * A file its contract refuses still holds the handle in its raw body, and
   * writing `<handle>.json` beside it would give the handle two files. When
   * several files the contract refuses hold it, none is the one to replace.
   *
   * @param handle - The handle.
   * @returns The project-relative path.
   * @throws {@link ConflictError} When more than one broken file holds the
   *   handle and no document does.
   * @throws {@link InvalidHandleError} When no file holds the handle and it is
   *   not a single safe path segment, so a file named after it would not be
   *   read back.
   */
  locate(handle: string): string {
    const document = this.findByHandle(handle);
    if (document !== undefined) {
      return document.path;
    }
    const holders = this.findBrokenByHandle(handle);
    if (holders.length > 1) {
      const paths = holders.map((file) => {
        return file.path;
      });
      throw new ConflictError(`${renderList(paths)} both hold ${handle}`, {
        hint: "Remove or fix all but one of them, then run the command again.",
        details: { handle, paths },
      });
    }
    const holder = holders[0];
    if (holder !== undefined) {
      return holder.path;
    }
    if (!SAFE_HANDLE.test(handle) || handle === "." || handle === "..") {
      throw new InvalidHandleError(handle);
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
   * nothing. The revision is written as the server answered it, whether or
   * not the local contract takes it: what a release pinned is what `pull`
   * writes, and the next deploy validates it. A file already there is
   * replaced, so it counts as edited, and saving needs no `overwrite`.
   *
   * @param handle - The handle the release pins it by.
   * @param revision - The body as the server answered it.
   * @returns The change.
   * @throws {@link ConflictError} When more than one broken file holds the
   *   handle and no document does.
   * @throws {@link InvalidHandleError} When no file holds the handle and it is
   *   not a single safe path segment.
   */
  placeRevision(handle: string, revision: JsonObject): Change {
    const path = this.locate(handle);
    const there = this.get(path) ?? this.findOwnBroken(path);
    const pointer = there?.body.$schema;
    const carried = typeof pointer === "string" && !("$schema" in revision);
    const body = carried ? { ...revision, $schema: pointer } : revision;
    if (there !== undefined && isDeepStrictEqual(there.body, body)) {
      return new Change({ before: this.config, after: this.config });
    }
    return new Change({
      before: this.config,
      after: this.config,
      files: [{ path, body, replaces: there !== undefined }],
    });
  }

  /**
   * Find the broken file of the kind whose raw body holds a handle.
   *
   * @param handle - The handle.
   * @returns Every broken file that holds it, none when no file does.
   */
  private findBrokenByHandle(handle: string): readonly BrokenFile[] {
    const field = HANDLE_FIELDS[this.directory];
    if (field === undefined) {
      return [];
    }
    return this.config.broken.filter((file) => {
      return file.kind === field.kind && file.body[field.key] === handle;
    });
  }
}

/**
 * Some of the documents of a collection, which answers the questions of any
 * collection about those alone.
 *
 * @typeParam T - The kind of document.
 */
class Subset<T extends AnyDocument> extends Collection<T> {
  /**
   * The kinds of file the collection the documents were taken from owns.
   */
  readonly kinds: readonly DocumentKind[];

  /**
   * Hold some documents of a collection.
   *
   * @param config - The configuration the collection is part of.
   * @param documents - The documents taken.
   * @param kinds - The kinds of file the source collection owns.
   */
  constructor(config: ZitadelConfig, documents: readonly T[], kinds: readonly DocumentKind[]) {
    super(config, documents);
    this.kinds = kinds;
  }
}
