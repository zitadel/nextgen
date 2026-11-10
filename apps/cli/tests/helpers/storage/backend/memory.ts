import { sep } from "node:path";

import { createFsFromVolume, type IFs, Volume } from "memfs";

import { Path } from "@/lib/zitadel/storage/path";
import { Store } from "@/lib/zitadel/storage/backend/store";

/**
 * The configuration held in memory, under a project's `.zitadel/`.
 *
 * @remarks
 * Everything it does is {@link Store}'s: this only says the files are in an
 * in-memory filesystem, under the project's directory, so it refuses, fails and
 * parses exactly as {@link DiskStore} does. A test arranges what the project
 * holds, and reads it back, through {@link MemoryStore.volume}.
 */
export class MemoryStore extends Store {
  /**
   * The project's directory in the in-memory filesystem, below its root so a
   * reference that climbs out of the project is caught, not clamped.
   */
  static readonly ROOT: string = Path.of(sep, "project").toString();

  /**
   * The in-memory filesystem the project is kept in.
   */
  readonly volume: IFs;

  /**
   * A store over one project's files.
   *
   * @param root - The project's root directory.
   */
  constructor(root: string = MemoryStore.ROOT) {
    const volume = createFsFromVolume(new Volume());
    super(volume, Path.of(root));
    this.volume = volume;
  }
}
