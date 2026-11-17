/**
 * Written proof that the caller means to delete a folder's local server and its
 * data, which cannot be undone. The caller asks the person first (the CLI's
 * confirmation) and only then makes one, so `reset` cannot be reached by
 * accident: nothing deletes without a permit for exactly that folder.
 */
export class DestroyPermit {
  /** The folder whose server and data the permit allows deleting. */
  readonly folder: string;

  private constructor(folder: string) {
    this.folder = folder;
  }

  /**
   * @param folder - The folder whose server and data may be deleted.
   * @returns A permit for exactly that folder.
   */
  static forFolder(folder: string): DestroyPermit {
    return new DestroyPermit(folder);
  }
}
