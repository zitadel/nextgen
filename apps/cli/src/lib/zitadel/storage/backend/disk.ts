import * as fs from "node:fs";

import { Path } from "@/lib/zitadel/storage/path";
import { Store } from "@/lib/zitadel/storage/backend/store";

/**
 * The configuration as files on disk, under a project's `.zitadel/`.
 *
 * @remarks
 * Everything it does is {@link Store}'s: this only says the files are on the
 * real filesystem, under the project's directory.
 */
export class DiskStore extends Store {
  /**
   * A store over one project's files.
   *
   * @param root - The project's root directory.
   */
  constructor(root: string) {
    super(fs, Path.of(root));
  }
}
