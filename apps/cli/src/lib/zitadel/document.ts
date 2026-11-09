import type { ConfigFile, JsonObject } from "@/lib/zitadel/types";
import type { WriteMode } from "@/lib/zitadel/storage/types";

/**
 * Where a document stands against the file it is saved to: as it was read,
 * edited since, or new and not yet written.
 */
export type DocumentStatus = "read" | "edited" | "created";

/**
 * One configuration file, as the library holds it: its path, its body exactly
 * as written, and where it stands against the file on disk.
 *
 * @remarks
 * Immutable. An edit returns a new document; the body is never changed in
 * place, so a document read once can be compared with what an edit made of it.
 * The body is kept whole, including fields the library has no use for, so
 * writing a document back loses nothing its author put there, and an edit keeps
 * the body's type: a caller that holds a typed body gets a typed body back.
 */
export abstract class ConfigDocument<Body extends JsonObject = JsonObject> {
  readonly path: string;
  readonly body: Body;
  readonly status: DocumentStatus;

  protected constructor(path: string, body: Body, status: DocumentStatus) {
    this.path = path;
    this.body = body;
    this.status = status;
  }

  /** Whether the document differs from the file on disk. */
  get changed(): boolean {
    return this.status !== "read";
  }

  /**
   * How saving the document writes its file: a new document never replaces a
   * file already there.
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
   * The status an edit leaves a document in: a new document stays new.
   *
   * @returns The status after an edit.
   */
  protected get editedStatus(): DocumentStatus {
    if (this.status === "created") {
      return "created";
    }
    return "edited";
  }
}
