import { BackendError, PreviewService, type ZitadelClient } from "@/lib/backend";
import { warnings } from "@/lib/ui/warnings";

/**
 * When previews expire, read from the live previews.
 *
 * @remarks
 * A deployment records no expiry of its own, so a caller that shows one reads
 * it from the previews. The expiry decorates what the caller shows, so a
 * failed read reports no expiry rather than failing the run.
 */
export class PreviewExpiries {
  /** The client every request goes through. */
  private readonly client: ZitadelClient;

  /** The project the previews belong to. */
  private readonly projectId: string;

  /**
   * @param client - The client every request goes through.
   * @param projectId - The project the previews belong to.
   */
  private constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * The previews of a project.
   *
   * @param client - The client every request goes through.
   * @param projectId - The project the previews belong to.
   * @returns The project's previews.
   */
  static of(client: ZitadelClient, projectId: string): PreviewExpiries {
    return new PreviewExpiries(client, projectId);
  }

  /**
   * A read that decorates a listing with when previews expire, which warns and
   * answers `none` when it fails instead of failing the listing.
   *
   * @remarks
   * The caller sees `none` either way, so it cannot tell a failed read from an
   * origin whose preview is gone; the warning says which.
   *
   * @param read - The read that finds out, which may fail.
   * @param none - What to answer when it fails.
   * @returns What `read` answers, or `none` after a warning when it fails.
   * @throws ZitadelError `E_CANCELLED` when the run was cancelled while reading.
   */
  static async reading<T>(read: () => Promise<T>, none: T): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof BackendError) {
        warnings.report(`Could not read when the previews expire: ${error.message}`);
        return none;
      }
      throw error;
    }
  }

  /**
   * When each of some preview origins expires, read from the live previews.
   *
   * @param origins - The preview origins to look for. None are read for an
   *   empty list.
   * @returns The expiry of each origin that still has a live preview, by origin;
   *   empty when the previews cannot be read, as {@link PreviewExpiries.reading} says.
   * @throws ZitadelError `E_CANCELLED` when the run was cancelled while reading.
   */
  async live(origins: Iterable<string>): Promise<ReadonlyMap<string, string>> {
    return PreviewExpiries.reading(() => {
      return new PreviewService(this.client, this.projectId).expiries(new Set(origins));
    }, new Map<string, string>());
  }
}
