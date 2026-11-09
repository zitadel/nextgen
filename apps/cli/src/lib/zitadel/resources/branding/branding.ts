import { brandingConfigSchema } from "@zitadel/config/schemas";
import { validateLoginTemplate } from "@zitadel/config/template";

import {
  DEFAULT_TEMPLATE_PATH,
  LEGACY_TEMPLATE_FILE_KEY,
} from "@/lib/zitadel/resources/branding/types";
import {
  ConfigDocument,
  type DocumentFile,
  type DocumentStatus,
} from "@/lib/zitadel/resources/document";
import { ConfigError } from "@/lib/zitadel/errors";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * A branding descriptor under `.zitadel/branding/`: the login's layout, its
 * asset URLs, and its template, inline or behind a `$file` reference to a file
 * beside it.
 */
export class Branding<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  /**
   * What kind of document this is: a branding descriptor.
   */
  readonly kind = "branding";

  /**
   * Hold a descriptor's body at its path.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(path: string, body: Body, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a branding descriptor as read.
   *
   * @param file - The file.
   * @returns The descriptor, marked as read.
   */
  static of<Body extends JsonObject>(file: DocumentFile<Body>): Branding<Body> {
    return new Branding(file.path, file.body, "read");
  }

  /**
   * A new descriptor, not yet written: saving it never replaces a file already
   * there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The descriptor, marked as created.
   */
  static create<Body extends JsonObject>(file: DocumentFile<Body>): Branding<Body> {
    return new Branding(file.path, file.body, "created");
  }

  /**
   * The descriptor as saved: what it holds is now what the file holds.
   *
   * @returns The same descriptor, marked as read.
   */
  asRead(): Branding<Body> {
    return new Branding(this.path, this.body, "read");
  }

  /**
   * Everything wrong with the descriptor on its own.
   *
   * @remarks
   * A descriptor that still names its template the old way gets how to
   * migrate it, not the bare unknown-key refusal the contract would give;
   * any other is held to the branding contract. With a store, a `$file`
   * reference that cannot be read is reported, since a deploy leaves it out of
   * what it sends and could not catch it later, and the template is held to
   * the rules the server applies, so a dry run still catches a template the
   * release would refuse.
   *
   * @param context - The store `$file` references are read from; without it
   *   the template checks are skipped.
   * @returns The `branding/legacy-template-key` or `contract/branding`
   *   findings, then the `branding/template-file` or `branding/template`
   *   ones; none when the descriptor is sound.
   * @throws Whatever reading a reference throws that is not a {@link ConfigError}.
   */
  problems(context: ValidationContext): readonly Issue[] {
    const legacy = this.body[LEGACY_TEMPLATE_FILE_KEY];
    const legacyPath = typeof legacy === "string" ? legacy : DEFAULT_TEMPLATE_PATH;
    const fileIssues =
      legacy === undefined
        ? this.contractIssues("contract/branding", brandingConfigSchema)
        : [
            this.issue(
              "branding/legacy-template-key",
              `${LEGACY_TEMPLATE_FILE_KEY} is no longer supported. Replace it with "liquid_template": { "$file": ${JSON.stringify(legacyPath)} }.`,
            ),
          ];
    if (context.store === undefined) {
      return fileIssues;
    }
    try {
      const template = this.template(context.store);
      if (legacy !== undefined || template === undefined) {
        return fileIssues;
      }
      const templateIssues = validateLoginTemplate(template)
        .filter((issue) => {
          return issue.severity === "error";
        })
        .map((issue) => {
          return this.issue("branding/template", `template ${issue.rule}: ${issue.message}`);
        });
      return [...fileIssues, ...templateIssues];
    } catch (error) {
      if (!(error instanceof ConfigError)) {
        throw error;
      }
      return [...fileIssues, this.issue("branding/template-file", error.message)];
    }
  }

  /**
   * The body the server receives.
   *
   * @remarks
   * A reference that cannot be read is left out rather than refused, so this
   * stays total; {@link problems} reports it.
   *
   * @param store - Where the referenced files are read from.
   * @returns The body with every `$file` reference inlined and without the
   *   editor-only `$schema` pointer.
   */
  wireBody(store: ConfigStore): JsonObject {
    return store.inlineReferences({ path: this.path, body: this.contractBody }, "omit");
  }

  /**
   * The template the descriptor carries, inline or behind a `$file` reference.
   *
   * @param store - Where the referenced file is read from.
   * @returns The template, or `undefined` when the descriptor has none.
   * @throws {@link ConfigError} When a reference names a file that cannot be read.
   */
  template(store: ConfigStore): string | undefined {
    const template = store.inlineReferences(this.toFile(), "throw").liquid_template;
    if (typeof template !== "string") {
      return undefined;
    }
    return template;
  }

  /**
   * The project-relative files the descriptor's references point at: editing
   * one changes what a deploy publishes, wherever it sits.
   *
   * @param store - Where the references are resolved.
   * @returns The paths; none when the descriptor references nothing.
   */
  referencedPaths(store: ConfigStore): readonly string[] {
    return store.referencedPaths(this.toFile());
  }
}
