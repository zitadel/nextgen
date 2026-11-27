import { OAUTH_FILE_SCHEMA_REF } from "@zitadel/config/meta-schemas";
import { oauthConfigSchema } from "@zitadel/config/schemas";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type ContractValue,
  type DocumentContract,
  type DocumentFile,
  type DocumentStatus,
  type Edit,
  type ReadableFile,
} from "@/lib/zitadel/resources/document";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import { CONFIG_DIRECTORIES, type JsonObject } from "@/lib/zitadel/types";

/**
 * What the OAuth settings hold once their contract took the body.
 */
export type OAuthSettingsValue = ContractValue<typeof oauthConfigSchema>;

/**
 * The OAuth settings under `.zitadel/oauth/`: whether the project's
 * authorization server answers, sent as the bundle's `oauth`.
 */
export class OAuthSettings extends ConfigDocument<OAuthSettingsValue> {
  /**
   * The contract the OAuth settings are held to.
   */
  static readonly CONTRACT: DocumentContract<typeof oauthConfigSchema> = {
    kind: "oauth",
    rule: "contract/oauth",
    schema: oauthConfigSchema,
  };

  /**
   * Where the settings live: the one file under `.zitadel/oauth/`.
   */
  static readonly PATH = `${CONFIG_DIRECTORIES.oauth}/oauth.json` as const;

  /**
   * What kind of document this is: the OAuth settings.
   */
  readonly kind = "oauth";

  /**
   * Hold settings the OAuth contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile, value: OAuthSettingsValue, status: DocumentStatus) {
    super(file, value, status);
  }

  /**
   * Read an OAuth settings file: the settings, or the broken file it is.
   *
   * @param file - The file.
   * @returns The settings, marked as read, or the broken file.
   */
  static read(file: ReadableFile): OAuthSettings | BrokenFile {
    return OAuthSettings.readFile(OAuthSettings.CONTRACT, file, (value, parsed) => {
      return new OAuthSettings(parsed, value, "read");
    });
  }

  /**
   * Take OAuth settings as read.
   *
   * @param file - The file.
   * @returns The settings, marked as read.
   * @throws {@link BrokenFilesError} When the OAuth contract refuses the body.
   */
  static of(file: DocumentFile): OAuthSettings {
    return OAuthSettings.build(file, "read");
  }

  /**
   * New settings, not yet written: saving them never replaces a file already
   * there.
   *
   * @param file - Where they go, and what they hold.
   * @returns The settings, marked as created.
   * @throws {@link BrokenFilesError} When the OAuth contract refuses the body.
   */
  static create(file: DocumentFile): OAuthSettings {
    return OAuthSettings.build(file, "created");
  }

  /**
   * The settings a project without any gets when its authorization server is
   * turned on: the switch, at {@link PATH}, with the editor's `$schema` pointer.
   *
   * @returns The settings, marked as created.
   */
  static enabled(): OAuthSettings {
    return OAuthSettings.create({
      path: OAuthSettings.PATH,
      body: { $schema: OAUTH_FILE_SCHEMA_REF, enabled: true },
    });
  }

  /**
   * Make settings of a body that must pass the OAuth contract, as every
   * factory does.
   *
   * @param file - The project-relative path and the body.
   * @param status - Where it stands against the file on disk.
   * @returns The settings.
   * @throws {@link BrokenFilesError} When the OAuth contract refuses the body.
   */
  private static build(file: DocumentFile, status: DocumentStatus): OAuthSettings {
    return new OAuthSettings(file, OAuthSettings.parseFile(OAuthSettings.CONTRACT, file), status);
  }

  /**
   * Whether the project's authorization server answers.
   *
   * @returns The switch as the file states it.
   */
  get enabled(): boolean {
    return this.value.enabled;
  }

  /**
   * The settings with the switch set.
   *
   * @param enabled - Whether the authorization server answers.
   * @returns The edit: the same settings when the switch is already so.
   */
  withEnabled(enabled: boolean): Edit<OAuthSettings> {
    if (this.enabled === enabled) {
      return { document: this, changed: false, skipped: [] };
    }
    return {
      document: OAuthSettings.build(
        { path: this.path, body: { ...this.body, enabled } },
        this.editedStatus,
      ),
      changed: true,
      skipped: [],
    };
  }

  /**
   * The body the server receives: the file without the editor-only `$schema`
   * pointer, as the settings reference nothing.
   *
   * @param _store - Unused: the settings hold no `$file` reference.
   * @returns The body to send.
   */
  toWireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }
}
