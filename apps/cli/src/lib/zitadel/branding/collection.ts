import type { Branding } from "@/lib/zitadel/branding/branding";
import { Collection } from "@/lib/zitadel/collection";

/**
 * The branding descriptors under `.zitadel/branding/`.
 *
 * @remarks
 * A deploy carries at most one, and refuses more; the collection holds every
 * file there so that refusal can name them.
 */
export class Brandings extends Collection<Branding> {}
