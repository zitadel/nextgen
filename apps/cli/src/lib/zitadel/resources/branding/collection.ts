import type { Branding } from "@/lib/zitadel/resources/branding/branding";
import { Collection } from "@/lib/zitadel/resources/collection";

/**
 * The branding descriptors under `.zitadel/branding/`.
 *
 * @remarks
 * A deploy carries at most one, and refuses more; the collection holds every
 * file there so that refusal can name them.
 */
export class Brandings extends Collection<Branding> {
  /**
   * The kind of file the collection owns.
   */
  readonly kinds = ["branding"] as const;
}
