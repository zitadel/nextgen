import type { Application } from "@/lib/zitadel/resources/applications/application";
import { Collection } from "@/lib/zitadel/resources/collection";

/**
 * The applications under `.zitadel/applications/`, which a release declares.
 */
export class Applications extends Collection<Application> {
  /**
   * The kind of file the collection owns.
   */
  readonly kinds = ["application"] as const;

  /**
   * The application a slug names: the first file in path order that has it,
   * so two files claiming one slug do not both stand for it.
   *
   * @param slug - The slug, as a file writes it.
   * @returns The application, or `undefined` when no file has the slug.
   */
  find(slug: string): Application | undefined {
    return this.all.find((application) => {
      return application.slug === slug;
    });
  }
}
