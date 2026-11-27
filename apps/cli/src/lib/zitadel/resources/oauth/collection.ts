import { Collection } from "@/lib/zitadel/resources/collection";
import type { OAuthSettings } from "@/lib/zitadel/resources/oauth/oauth";

/**
 * The OAuth settings files under `.zitadel/oauth/`.
 *
 * @remarks
 * A deploy carries at most one, and refuses more; the collection holds every
 * file there so that refusal can name them.
 */
export class OAuthSettingsCollection extends Collection<OAuthSettings> {
  /**
   * The kind of file the collection owns.
   */
  readonly kinds = ["oauth"] as const;
}
