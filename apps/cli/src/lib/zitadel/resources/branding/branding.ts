import { brandingConfigSchema } from "@zitadel/config/schemas";
import { validateLoginTemplate } from "@zitadel/config/template";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  type BrandingValue,
  DEFAULT_TEMPLATE_PATH,
  LEGACY_TEMPLATE_FILE_KEY,
} from "@/lib/zitadel/resources/branding/types";
import {
  ConfigDocument,
  type DocumentContract,
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
export class Branding extends ConfigDocument<JsonObject, BrandingValue> {
  /**
   * The contract a branding descriptor is held to.
   *
   * @remarks
   * A file it refuses is broken by the `contract/branding` refusals, or, for a
   * descriptor that still names its template the old way, by how to migrate
   * it in place of the bare unknown-key refusal, as {@link explainRefusals}
   * words it.
   */
  static readonly CONTRACT: DocumentContract<typeof brandingConfigSchema> = {
    kind: "branding",
    rule: "contract/branding",
    schema: brandingConfigSchema,
    explain: (file, refusals) => {
      return Branding.explainRefusals(file, refusals);
    },
  };

  /**
   * What kind of document this is: a branding descriptor.
   */
  readonly kind = "branding";

  /**
   * Hold a descriptor the branding contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile, value: BrandingValue, status: DocumentStatus) {
    super(file, value, status);
  }

  /**
   * Read a branding descriptor file: the descriptor, or the broken file it is.
   *
   * @param file - The file.
   * @returns The descriptor, marked as read, or the broken file.
   */
  static read(file: DocumentFile): Branding | BrokenFile {
    return Branding.readFile(Branding.CONTRACT, file, (value) => {
      return new Branding(file, value, "read");
    });
  }

  /**
   * Take a branding descriptor as read.
   *
   * @param file - The file.
   * @returns The descriptor, marked as read.
   * @throws {@link BrokenFilesError} When the branding contract refuses the body.
   */
  static of(file: DocumentFile): Branding {
    return Branding.build(file, "read");
  }

  /**
   * A new descriptor, not yet written: saving it never replaces a file already
   * there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The descriptor, marked as created.
   * @throws {@link BrokenFilesError} When the branding contract refuses the body.
   */
  static create(file: DocumentFile): Branding {
    return Branding.build(file, "created");
  }

  /**
   * Make a descriptor of a body that must pass the branding contract, as
   * every factory does.
   *
   * @param file - The project-relative path and the body.
   * @param status - Where it stands against the file on disk.
   * @returns The descriptor.
   * @throws {@link BrokenFilesError} When the branding contract refuses the body.
   */
  private static build(file: DocumentFile, status: DocumentStatus): Branding {
    return new Branding(file, Branding.parseFile(Branding.CONTRACT, file), status);
  }

  /**
   * The descriptor as saved: what it holds is now what the file holds.
   *
   * @returns The same descriptor, marked as read.
   */
  markRead(): Branding {
    return new Branding(this.file, this.value, "read");
  }

  /**
   * What else is wrong with the descriptor on its own, beyond what its
   * contract refuses.
   *
   * @remarks
   * With a store, a `$file` reference that cannot be read is reported, since
   * a deploy leaves it out of what it sends and could not catch it later, and
   * the template is held to the rules the server applies, so a dry run still
   * catches a template the release would refuse.
   *
   * @param context - The store `$file` references are read from; without it
   *   the template checks are skipped.
   * @returns The `branding/template-file` or `branding/template` findings;
   *   none when the descriptor is sound.
   * @throws Whatever reading a reference throws that is not a {@link ConfigError}.
   */
  override check(context: ValidationContext): readonly Issue[] {
    if (context.store === undefined) {
      return [];
    }
    try {
      const template = this.readTemplate(context.store);
      if (template === undefined) {
        return [];
      }
      return validateLoginTemplate(template)
        .filter((issue) => {
          return issue.severity === "error";
        })
        .map((issue) => {
          return this.makeIssue("branding/template", `template ${issue.rule}: ${issue.message}`);
        });
    } catch (error) {
      if (!(error instanceof ConfigError)) {
        throw error;
      }
      return [this.makeIssue("branding/template-file", error.message)];
    }
  }

  /**
   * Word what the branding contract refused of a descriptor: how to migrate a
   * template named the old way, or the refusals as they are.
   *
   * @remarks
   * Reads the body as written: a refused file has no typed value, and the
   * legacy key is one the contract does not know.
   *
   * @param file - The descriptor the contract refused.
   * @param refusals - The `contract/branding` refusals.
   * @returns The `branding/legacy-template-key` finding, or the refusals.
   */
  private static explainRefusals(file: DocumentFile, refusals: readonly Issue[]): readonly Issue[] {
    const legacy = file.body[LEGACY_TEMPLATE_FILE_KEY];
    if (legacy === undefined) {
      return refusals;
    }
    const legacyPath = typeof legacy === "string" ? legacy : DEFAULT_TEMPLATE_PATH;
    const reference = JSON.stringify(legacyPath);
    return [
      Branding.makeFileIssue(
        file.path,
        "branding/legacy-template-key",
        `${LEGACY_TEMPLATE_FILE_KEY} is no longer supported. Replace it with "liquid_template": { "$file": ${reference} }.`,
      ),
    ];
  }

  /**
   * The body the server receives.
   *
   * @remarks
   * Built from the body as written, not the typed value, since the `$file`
   * reference must still be there for the store to inline. A reference that
   * cannot be read is left out rather than refused, so this stays total;
   * {@link check} reports it.
   *
   * @param store - Where the referenced files are read from.
   * @returns The body with every `$file` reference inlined and without the
   *   editor-only `$schema` pointer.
   */
  toWireBody(store: ConfigStore): JsonObject {
    return store.inlineReferences({ path: this.path, body: this.contractBody }, "omit");
  }

  /**
   * Read the template the descriptor carries, inline or behind a `$file`
   * reference.
   *
   * @remarks
   * An inline template is read from the typed value. A reference is inlined
   * from the body as written, since the store resolves it against the file
   * that holds it; the contract allows nothing but a string or a reference
   * there, so a reference read under `throw` always gives a string.
   *
   * @param store - Where the referenced file is read from.
   * @returns The template, or `undefined` when the descriptor has none.
   * @throws {@link ConfigError} When a reference names a file that cannot be read.
   */
  readTemplate(store: ConfigStore): string | undefined {
    const template = this.value.liquid_template;
    if (template === undefined || typeof template === "string") {
      return template;
    }
    const inlined = store.inlineReferences(this.file, "throw").liquid_template;
    if (typeof inlined !== "string") {
      return undefined;
    }
    return inlined;
  }

  /**
   * List the project-relative files the descriptor's references point at:
   * editing one changes what a deploy publishes, wherever it sits.
   *
   * @remarks
   * Reads the body as written, where each `$file` reference still names its
   * file, and which the store resolves against the file that holds it.
   *
   * @param store - Where the references are resolved.
   * @returns The paths; none when the descriptor references nothing.
   */
  listReferencedPaths(store: ConfigStore): readonly string[] {
    return store.listReferencedPaths(this.file);
  }
}
