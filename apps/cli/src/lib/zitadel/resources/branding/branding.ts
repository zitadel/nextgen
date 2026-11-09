import { brandingConfigSchema } from "@zitadel/config/schemas";
import { validateLoginTemplate } from "@zitadel/config/template";
import type { z } from "zod";

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
  type ReadableFile,
  type DocumentStatus,
} from "@/lib/zitadel/resources/document";
import { ConfigError } from "@/lib/zitadel/errors";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { withoutKey, withoutPath } from "@/lib/zitadel/utils/json";

/**
 * A branding descriptor under `.zitadel/branding/`: the login's layout, its
 * asset URLs, and its template, inline or behind a `$file` reference to a file
 * beside it.
 */
export class Branding extends ConfigDocument<BrandingValue> {
  /**
   * The contract a branding descriptor is held to.
   *
   * @remarks
   * A file it refuses is broken by the `contract/branding` refusals, each
   * mistake said once, or, for a descriptor that still names its template the
   * old way, by how to migrate it in place of the bare unknown-key refusal, as
   * {@link explainRefusals} words it.
   */
  static readonly CONTRACT: DocumentContract<typeof brandingConfigSchema> = {
    kind: "branding",
    rule: "contract/branding",
    schema: brandingConfigSchema,
    explain: (file) => {
      return Branding.explainRefusals(file);
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
  static read(file: ReadableFile): Branding | BrokenFile {
    return Branding.readFile(Branding.CONTRACT, file, (value, parsed) => {
      return new Branding(parsed, value, "read");
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
   * template named the old way, beside every other refusal the body has, each
   * said once and in plain words.
   *
   * @remarks
   * The contract reports every unknown key in one refusal, so the retired key
   * cannot be filtered out of the refusals it came with: the body is held to
   * the contract again without that key, and what that refuses is kept. Reads
   * the body as written, without the editor-only `$schema` pointer the
   * contract is never held to: a refused file has no typed value.
   *
   * @param file - The descriptor the contract refused.
   * @returns The `branding/legacy-template-key` finding first when the body
   *   has a retired key, then the refusals the rest of the body has.
   */
  private static explainRefusals(file: DocumentFile): readonly Issue[] {
    const legacy = file.body[LEGACY_TEMPLATE_FILE_KEY];
    const refusals = Branding.wordRefusals(
      file,
      withoutKey(withoutKey(file.body, LEGACY_TEMPLATE_FILE_KEY), "$schema"),
    );
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
      ...refusals,
    ];
  }

  /**
   * The branding contract's refusals of a body, one finding per mistake.
   *
   * @remarks
   * Some fields are held to a generated pattern or format as well as to a
   * check of the contract's own that says what a valid value looks like, so
   * one mistake is refused twice: once by a raw regex and once in plain words.
   * The contract's own refusal names its field as the first word of its
   * message and has no path, so the generic refusals at that field are
   * dropped and the plain one is reported as it is, without a `(root)`
   * location.
   *
   * The contract's own checks only run once every field has the right type
   * and one of its values, so a body with such a mistake elsewhere would show
   * the raw regex and nothing else. The fields with such a mistake are set
   * aside and the rest of the body is held to the contract again, so its own
   * checks speak too. A check of the contract's own that fails only because a
   * field it names was set aside, such as a font URL left without the family
   * that was refused, is not reported: the refusal of the field says it.
   *
   * @param file - The file the body is from, which findings are filed under.
   * @param body - The body to hold to the contract.
   * @returns The findings; none when the body passes.
   */
  private static wordRefusals(file: DocumentFile, body: JsonObject): readonly Issue[] {
    const first = Branding.CONTRACT.schema.safeParse(body);
    if (first.success) {
      return [];
    }
    const setAside = first.error.issues.filter((refusal) => {
      return refusal.code !== "custom" && refusal.code !== "invalid_format";
    });
    let refusals = first.error.issues;
    if (setAside.length > 0) {
      const rest = Branding.CONTRACT.schema.safeParse(Branding.withoutRefused(body, setAside));
      const aside = Branding.fieldsRefused(setAside);
      const later = rest.success ? [] : rest.error.issues;
      refusals = [
        ...setAside,
        ...later.filter((refusal) => {
          return !Branding.isCausedByPruning(refusal, aside);
        }),
      ];
    }
    const named = new Set<string>();
    for (const refusal of refusals) {
      if (refusal.code === "custom" && refusal.path.length === 0) {
        named.add(Branding.fieldNamedBy(refusal.message));
      }
    }
    return refusals
      .filter((refusal) => {
        return refusal.code === "custom" || !named.has(refusal.path.join("."));
      })
      .map((refusal) => {
        if (
          refusal.code === "custom" &&
          refusal.path.length === 0 &&
          named.has(Branding.fieldNamedBy(refusal.message))
        ) {
          return Branding.makeFileIssue(file.path, Branding.CONTRACT.rule, refusal.message);
        }
        const where = refusal.path.join(".") || "(root)";
        return Branding.makeFileIssue(
          file.path,
          Branding.CONTRACT.rule,
          `${where} ${refusal.message}`,
        );
      });
  }

  /**
   * The dotted names of the fields the contract refused.
   *
   * @param refusals - The refusals; an unknown key is refused at the object
   *   that holds it.
   * @returns One name per field, an unknown key's included.
   */
  private static fieldsRefused(refusals: readonly z.core.$ZodIssue[]): readonly string[] {
    const fields: string[] = [];
    for (const refusal of refusals) {
      if (refusal.code === "unrecognized_keys") {
        for (const key of refusal.keys) {
          fields.push([...refusal.path, key].join("."));
        }
      } else {
        fields.push(refusal.path.join("."));
      }
    }
    return fields;
  }

  /**
   * Whether a refusal of the contract's own checks is only there because a
   * field was set aside.
   *
   * @remarks
   * Such a check names the field it is about first and any field it depends
   * on after, as `typography.font_url needs a typography.font_family`, so it
   * is caused by pruning when it names a field that was set aside, other than
   * the one it is about.
   *
   * @param refusal - A refusal of the body without the fields set aside.
   * @param aside - The fields that were set aside.
   * @returns True when the refusal would not exist had the field been kept.
   */
  private static isCausedByPruning(refusal: z.core.$ZodIssue, aside: readonly string[]): boolean {
    if (refusal.code !== "custom" || refusal.path.length > 0) {
      return false;
    }
    const about = Branding.fieldNamedBy(refusal.message);
    const named = refusal.message.split(" ").map((word) => {
      return word.replace(/[.,;]$/, "");
    });
    return aside.some((field) => {
      return field !== about && named.includes(field);
    });
  }

  /**
   * The field a message of the contract's own checks is about.
   *
   * @param message - A message that starts with the field's dotted name.
   * @returns The first word of the message.
   */
  private static fieldNamedBy(message: string): string {
    return message.split(" ")[0] ?? "";
  }

  /**
   * A body without the members the contract refused for their type or value.
   *
   * @param body - The body as written.
   * @param refusals - The refusals whose members are set aside; an unknown key
   *   is refused at the object that holds it.
   * @returns The body without those members.
   */
  private static withoutRefused(
    body: JsonObject,
    refusals: readonly z.core.$ZodIssue[],
  ): JsonObject {
    let rest = body;
    for (const refusal of refusals) {
      if (refusal.code === "unrecognized_keys") {
        for (const key of refusal.keys) {
          rest = withoutPath(rest, [...refusal.path, key]);
        }
      } else {
        rest = withoutPath(rest, refusal.path);
      }
    }
    return rest;
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
  private readTemplate(store: ConfigStore): string | undefined {
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
