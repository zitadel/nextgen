import { referencedVariable } from "@zitadel/config/idp";
import { applicationConfigSchema, declaredApplicationIssues } from "@zitadel/config/schemas";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import type { ApplicationValue } from "@/lib/zitadel/resources/applications/types";
import {
  ConfigDocument,
  type DocumentContract,
  type DocumentFile,
  type DocumentStatus,
  type ReadableFile,
} from "@/lib/zitadel/resources/document";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * An application under `.zitadel/applications/`, which a release declares:
 * its name and the OAuth clients it signs users in with (ADR 082 §3).
 */
export class Application extends ConfigDocument<ApplicationValue> {
  /**
   * The contract an application is held to: the document `POST /applications`
   * takes, as a release declares it, with every client's `client_id` and
   * every confidential client's `secret` set. Those two are read from the body
   * as written, so they are reported beside the rest of a client's refusals.
   */
  static readonly CONTRACT: DocumentContract<typeof applicationConfigSchema> = {
    kind: "application",
    rule: "contract/application",
    schema: applicationConfigSchema,
    refuse: declaredApplicationIssues,
  };

  /**
   * What kind of document this is: a declared application.
   */
  readonly kind = "application";

  /**
   * Hold an application the application contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile, value: ApplicationValue, status: DocumentStatus) {
    super(file, value, status);
  }

  /**
   * Read an application file: the application, or the broken file it is.
   *
   * @param file - The file.
   * @returns The application, marked as read, or the broken file.
   */
  static read(file: ReadableFile): Application | BrokenFile {
    return Application.readFile(Application.CONTRACT, file, (value, parsed) => {
      return new Application(parsed, value, "read");
    });
  }

  /**
   * Take an application as read.
   *
   * @param file - The file.
   * @returns The application, marked as read.
   * @throws {@link BrokenFilesError} When the application contract refuses the body.
   */
  static of(file: DocumentFile): Application {
    return Application.build(file, "read");
  }

  /**
   * A new application, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The application, marked as created.
   * @throws {@link BrokenFilesError} When the application contract refuses the body.
   */
  static create(file: DocumentFile): Application {
    return Application.build(file, "created");
  }

  /**
   * Make an application of a body that must pass the application contract,
   * as every factory does.
   *
   * @param file - The project-relative path and the body.
   * @param status - Where it stands against the file on disk.
   * @returns The application.
   * @throws {@link BrokenFilesError} When the application contract refuses the body.
   */
  private static build(file: DocumentFile, status: DocumentStatus): Application {
    return new Application(file, Application.parseFile(Application.CONTRACT, file), status);
  }

  /**
   * The slug the release pins the application by.
   *
   * @returns The slug.
   */
  get slug(): string {
    return this.value.slug;
  }

  /**
   * The project variable each client names as its secret.
   *
   * @returns Each client's slug and variable, in the order the clients are
   *   written; a client that names none is left out.
   */
  get secretVariables(): readonly { readonly client: string; readonly variable: string }[] {
    return this.value.clients.flatMap((client) => {
      const variable = client.secret === undefined ? undefined : referencedVariable(client.secret);
      if (variable === undefined) {
        return [];
      }
      return [{ client: client.slug, variable }];
    });
  }

  /**
   * The body the server receives.
   *
   * @param _store - Unused: an application references no other file.
   * @returns The body without the editor-only `$schema` pointer.
   */
  toWireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }
}
