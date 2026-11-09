import { ConfigDocument, type DocumentStatus } from "@/lib/zitadel/document";
import { RefusedEditError } from "@/lib/zitadel/errors";
import type { ConfigFile, JsonObject } from "@/lib/zitadel/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";

/**
 * The key descriptors used before `$file` references, still recognised so the
 * refusal can say how to migrate instead of reporting an unknown key.
 */
const LEGACY_TEMPLATE_FILE_KEY = "liquid_template_file";

/**
 * A branding descriptor under `.zitadel/branding/`: the login's layout, its
 * asset URLs, and its template, inline or behind a `$file` reference to a file
 * beside it.
 */
export class Branding extends ConfigDocument {
  private constructor(path: string, body: JsonObject, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a branding descriptor as read.
   *
   * @param file - The file.
   * @returns The descriptor.
   */
  static of(file: ConfigFile): Branding {
    return new Branding(file.path, file.body, "read");
  }

  /**
   * A new descriptor, not yet written: saving it never replaces a file already
   * there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The descriptor.
   */
  static create(file: ConfigFile): Branding {
    return new Branding(file.path, file.body, "created");
  }

  /**
   * The document as saved: what it holds is now what the file holds.
   *
   * @returns The document, marked as read.
   */
  asRead(): Branding {
    return new Branding(this.path, this.body, "read");
  }

  /**
   * Refuse a descriptor that still names its template the old way, with how to
   * migrate it.
   *
   * @throws {@link RefusedEditError} When it carries `liquid_template_file`.
   */
  assertCurrentTemplateKey(): void {
    const legacy = this.body[LEGACY_TEMPLATE_FILE_KEY];
    if (legacy === undefined) {
      return;
    }
    const path = typeof legacy === "string" ? legacy : "./login.liquid";
    throw new RefusedEditError(`${LEGACY_TEMPLATE_FILE_KEY} is no longer supported`, {
      hint: `Replace it with "liquid_template": { "$file": ${JSON.stringify(path)} }.`,
    });
  }

  /**
   * The template the descriptor carries, inline or behind a `$file` reference.
   *
   * @param store - Where the referenced file is read from.
   * @returns The template, or `undefined` when the descriptor has none.
   * @throws When a reference names a file that cannot be read.
   */
  template(store: ConfigStore): string | undefined {
    const template = store.inlineReferences(this.toFile(), "throw").liquid_template;
    if (typeof template !== "string") {
      return undefined;
    }
    return template;
  }

  /**
   * The body the server takes: every `$file` reference inlined and the
   * editor's `$schema` pointer gone. A reference that cannot be read is left
   * out rather than refused, so this stays total; the deploy's checks report it.
   *
   * @param store - Where the referenced files are read from.
   * @returns The body to send.
   */
  wireBody(store: ConfigStore): JsonObject {
    const { $schema: _editorOnly, ...body } = this.body;
    return store.inlineReferences({ path: this.path, body }, "omit");
  }

  /**
   * The project-relative files the descriptor's references point at: editing
   * one changes what a deploy publishes, wherever it sits.
   *
   * @param store - Where the references are resolved.
   * @returns The paths.
   */
  referencedPaths(store: ConfigStore): readonly string[] {
    return store.referencedPaths(this.toFile());
  }
}
