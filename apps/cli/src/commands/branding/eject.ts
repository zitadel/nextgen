import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Flags } from "@oclif/core";
import { consola } from "consola";

import {
  type BrandingDesign,
  BRANDING_DESIGNS,
  DEFAULT_BRANDING_CONFIG_PATH,
  DEFAULT_BRANDING_DESIGN,
  DEFAULT_BRANDING_TEMPLATE_PATH,
  brandingReadmeContent,
  getDefaultBrandingConfig,
} from "@zitadel/config/defaults";
import { BRANDING_FILE_SCHEMA_REF, META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";

import { BRANDING_DIR } from "@/lib/branding";
import {
  BRANDING_DESIGN_INFO,
  PAGE_LAYOUT_HINT,
  RETIRED_BRANDING_DESIGNS,
} from "@/lib/branding/designs";
import { isErrno, ZitadelError } from "@/lib/errors";
import { stableStringify } from "@/lib/json";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { hasZitadelConfig } from "@/lib/project";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { filled, reads, suggesterOf } from "@/lib/oclif/flags";
import { metaSchemaState, projectMetaSchemas } from "@/lib/meta-schemas";
import { normalizePublicCliProse } from "@/lib/public-cli";
import { DEPLOY_ARGS } from "@/lib/suggestion";
import { Promptable } from "@/lib/oclif/promptable";

/** The shipped designs, as a list for a hint to offer. */
const DESIGN_CATALOG = BRANDING_DESIGNS.join(", ");

/** How a directory that `setup` has not made a project is refused. */
const NOT_A_PROJECT_REFUSAL: Refusal = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; branding files live under .zitadel/.",
  next: ["setup"],
};

/**
 * How a `--design` the eject catalog used to ship is refused, by name, with a
 * pointer to where page layout lives now, so scripts and agents that learned
 * `--design split` get an actionable error instead of oclif's generic one.
 */
const RETIRED_DESIGN_REFUSAL: Refusal = {
  message: "The {design} design was retired: it was page layout, not widget structure",
  hint: `${PAGE_LAYOUT_HINT} To own the widget's structure, eject one of: ${DESIGN_CATALOG}.`,
  next: ["branding eject --design centered"],
};

/**
 * How a `--design` that names no design, retired or shipped, is refused. The
 * value is quoted as JSON, so an escape sequence in it reads as text rather
 * than driving the terminal it is printed on.
 */
const UNKNOWN_DESIGN_REFUSAL: Refusal = {
  message: "Unknown design {design}",
  hint: `Pick one of: ${DESIGN_CATALOG}.`,
};

/**
 * The `parse` of `--design`: a design the CLI ships, refused by name where it
 * names one that was retired, and as unknown where it names none. Both are
 * refused on the way in, so nothing the command does can run against a design
 * that does not exist, and each keeps its own words and follow-up.
 */
async function readsDesign(
  given: string,
  command: unknown,
  definition: { name: string },
): Promise<BrandingDesign> {
  const design = await reads<string>({
    schema: filled,
    refusal: {
      message: "{input} was given an empty value",
      hint: "Pass a value for {input}, or omit it entirely.",
    },
  })(given, command, definition);
  if (isRetiredDesign(design)) {
    throw refusalError(RETIRED_DESIGN_REFUSAL, { design }, suggesterOf(command));
  }
  if (!isBrandingDesign(design)) {
    throw refusalError(UNKNOWN_DESIGN_REFUSAL, { design: JSON.stringify(design) });
  }
  return design;
}

/** Whether `value` names a design the CLI ships. */
function isBrandingDesign(value: string): value is BrandingDesign {
  return (BRANDING_DESIGNS as readonly string[]).includes(value);
}

/** Whether `value` names a design the CLI used to ship and retired. */
function isRetiredDesign(value: string): boolean {
  return (RETIRED_BRANDING_DESIGNS as readonly string[]).includes(value);
}

/**
 * The `branding eject` command — take ownership of the login template.
 *
 * Scaffolds `.zitadel/branding/` from a shipped design: the `branding.json`
 * descriptor, the `login.liquid` template it references, a README, and the
 * branding dialect meta-schema when the project's copy is missing or
 * outdated (set up before the dialect existed or changed).
 * Purely local — nothing is uploaded; the first `zitadel deploy` publishes
 * revision 1. Ejecting the template is the last rung of the branding
 * override ladder (docs/design/branding/override-ladder.md); unrelated to
 * `zitadel eject`, which removes the Zitadel integration.
 */
export default class BrandingEject extends Promptable(BaseCommand) {
  static override description =
    "Take ownership of the login template: scaffold .zitadel/branding/ from a shipped design.";

  static override heading = "Ejecting the branding template";

  static override group = CommandGroups.configuration;
  static override flags = {
    force: Flags.boolean({ char: "f", description: "Overwrite an existing branding file." }),
    // No oclif `options`: a retired design (#1039) is refused by name, with a
    // pointer to where page layout lives now, rather than by oclif's generic
    // "expected one of".
    design: Flags.custom<BrandingDesign>({
      parse: readsDesign,
    })({
      description: `Design to start from: ${BRANDING_DESIGNS.join(" or ")} (default: ${DEFAULT_BRANDING_DESIGN}).`,
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  protected async execute({ flags }: Admitted<typeof BrandingEject>): Promise<JsonEnvelope> {
    const suggest = (next: string) => {
      return this.suggestUnscoped(next);
    };
    if (!(await hasZitadelConfig(this.cwd))) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {}, suggest);
    }
    // The checks above refused one that is not a design, so a value that got
    // here is either a design or absent, and absent is asked for.
    const design = flags.design ?? (await this.promptDesign(this.nonInteractive));
    this.recordTelemetry({ design, force: this.force });
    const { branding, template } = getDefaultBrandingConfig(design);

    const filesWritten: string[] = [];
    const write = async (relPath: string, content: string, overwrite: boolean): Promise<void> => {
      const dest = join(this.cwd, relPath);
      await mkdir(dirname(dest), { recursive: true });
      try {
        await writeFile(dest, content, overwrite ? undefined : { flag: "wx" });
        filesWritten.push(relPath);
      } catch (error) {
        if (isErrno(error, "EEXIST")) {
          throw new ZitadelError("E_CONFLICT", `${relPath} already exists`, {
            hint: "Rerun with --force to replace it, or edit the existing file directly.",
          });
        }
        throw error;
      }
    };

    await write(
      DEFAULT_BRANDING_CONFIG_PATH,
      `${stableStringify({ $schema: BRANDING_FILE_SCHEMA_REF, ...branding })}\n`,
      this.force,
    );
    await write(DEFAULT_BRANDING_TEMPLATE_PATH, template, this.force);

    // Never overwrite a hand-edited README.
    await write(
      join(BRANDING_DIR, "README.md"),
      normalizePublicCliProse(brandingReadmeContent(), this.cliVersion),
      false,
    ).catch(swallowConflict);
    // The descriptor's `$schema` must resolve to the dialect it was written
    // in, so the CLI-owned meta-schema is written when missing or outdated,
    // as `doctor --fix` does; one that cannot be read, or sits behind a
    // symlink, is doctor's to report.
    const brandingMeta = projectMetaSchemas(this.cliVersion).find(
      (file) => file.path === `${META_SCHEMA_DIR}/branding.json`,
    );
    if (brandingMeta) {
      const state = await metaSchemaState(this.cwd, brandingMeta).catch(() => "current" as const);
      if (state === "missing" || state === "outdated") {
        await write(brandingMeta.path, brandingMeta.contents, true);
      }
    }

    for (const file of filesWritten) {
      consola.info(`Wrote ${file}`);
    }
    // Said once, by the line the command ends on.
    const ejected = `Ejected the ${BRANDING_DESIGN_INFO[design].label} design into ${BRANDING_DIR}/`;

    return this.emit({
      status: "ok",
      boxed: true,
      data: {
        title: ejected,
        design,
        files_written: filesWritten,
      },
      next: {
        actions: [
          `Edit ${DEFAULT_BRANDING_TEMPLATE_PATH} — the login UI is yours now.`,
          // The two commands are the box's own steps, so the sentence says
          // what they are for and leaves the spelling to them: a suggestion
          // written out here as well would name each command twice.
          "Validate the template and see the diff with a dry run, then publish it.",
        ],
        commands: [this.suggestUnscoped("deploy --dry-run"), this.suggestUnscoped(DEPLOY_ARGS)],
      },
      summary: {
        title: ejected,
        sections: [],
        lines: [`Files: ${filesWritten.length} written, 0 unchanged`],
      },
    });
  }

  private async promptDesign(nonInteractive: boolean): Promise<BrandingDesign> {
    if (nonInteractive) {
      return DEFAULT_BRANDING_DESIGN;
    }
    return this.ask.select({
      name: "design",
      message: "Which design would you like to start from?",
      initialValue: DEFAULT_BRANDING_DESIGN,
      options: BRANDING_DESIGNS.map((design) => ({
        value: design,
        label: BRANDING_DESIGN_INFO[design].label,
        hint: BRANDING_DESIGN_INFO[design].hint,
      })),
    });
  }
}

function swallowConflict(error: unknown): void {
  if (error instanceof ZitadelError && error.code === "E_CONFLICT") {
    return;
  }
  throw error;
}
