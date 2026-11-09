import { isDeepStrictEqual } from "node:util";

import { Change } from "@/lib/zitadel/change";
import type { AnyDocument, ZitadelConfig } from "@/lib/zitadel/config";
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
   * A broken file at the path is removed too, since it stands in the way just
   * as a document does. A path that holds neither changes nothing, so
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
    const broken = this.config.findBroken(path);
    if (broken !== undefined) {
      return new Change({ before: this.config, after: this.config.withoutBroken(broken) });
    }
    return new Change({ before: this.config, after: this.config });
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
   * Locate where a document a release pins by a handle goes: the file that
   * holds the handle, or `<handle>.json` when none does.
   *
   * @remarks
   * A file its contract refuses still holds the handle in its raw body, and
   * writing `<handle>.json` beside it would give the handle two files.
   *
   * @param handle - The handle.
   * @returns The project-relative path.
   */
  locate(handle: string): string {
    const holder = this.findByHandle(handle) ?? this.findBrokenByHandle(handle);
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
   * nothing. The revision is written as the server answered it, whether or
   * not the local contract takes it: what a release pinned is what `pull`
   * writes, and the next deploy validates it. A file already there is
   * replaced, so it counts as edited, and saving needs no `overwrite`.
   *
   * @param handle - The handle the release pins it by.
   * @param revision - The body as the server answered it.
   * @returns The change.
   */
  placeRevision(handle: string, revision: JsonObject): Change {
    const path = this.locate(handle);
    const there = this.get(path) ?? this.config.findBroken(path);
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
   * @returns The first broken file that holds it, or `undefined` when none does.
   */
  private findBrokenByHandle(handle: string): BrokenFile | undefined {
    const field = HANDLE_FIELDS[this.directory];
    if (field === undefined) {
      return undefined;
    }
    return this.config.broken.find((file) => {
      return file.kind === field.kind && file.body[field.key] === handle;
    });
  }
}
