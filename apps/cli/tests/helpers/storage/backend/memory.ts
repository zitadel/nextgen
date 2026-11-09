import { sep } from "node:path";

import { createFsFromVolume, type IFs, Volume } from "memfs";

import { Path } from "@/lib/zitadel/storage/path";
import { Store } from "@/lib/zitadel/storage/backend/store";

/**
 * The directory an in-memory project stands in, so its references resolve
 * the way they would on disk.
 *
 * @remarks
 * Nothing real is ever read from it. It is a directory below the filesystem
 * root, so a reference that climbs out of the project is caught, not clamped
 * at the root.
 */
const ROOT = Path.of(sep, "project");

/**
 * The configuration held in memory: what a test hands the library instead of
 * a disk.
 *
 * @remarks
 * Everything it does is {@link Store}'s, over an in-memory filesystem, so it
 * refuses, fails and parses exactly as {@link DiskStore} does. A test arranges
 * what the project holds, and reads it back, through the filesystem it gives.
 */
export class MemoryStore extends Store {
  /**
   * The in-memory filesystem the project is kept in.
   */
  readonly volume: IFs;

  /**
   * Where the project is in {@link MemoryStore.volume}.
   */
  static readonly ROOT: string = ROOT.toString();

  /**
   * A store over one project's files.
   *
   */
  constructor() {
    const volume = createFsFromVolume(new Volume());
    super(volume, ROOT);
    this.volume = volume;
  }
}
