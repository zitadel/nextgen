import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Flags } from "@oclif/core";
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

import { isErrno, ZitadelError } from "@/lib/errors";
import { log } from "@/lib/log";
import { projectMetaSchemas, writeMetaSchemas } from "@/lib/meta-schemas";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { filled, reads, suggesterOf } from "@/lib/oclif/flags";
import { Promptable } from "@/lib/oclif/promptable";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { Suggestible } from "@/lib/oclif/suggestible";
import { hasZitadelConfig } from "@/lib/project";
import { normalizePublicCliProse } from "@/lib/public-cli";
import { DEPLOY_ARGS } from "@/lib/suggestion";
import {
  BRANDING_DESIGN_INFO,
  Branding,
  CONFIG_DIRECTORIES,
  DiskStore,
  FileExistsError,
  PAGE_LAYOUT_HINT,
  RETIRED_BRANDING_DESIGNS,
  ZitadelConfig,
} from "@/lib/zitadel";

/** The shipped designs, as a list for a hint to offer. */
const DESIGN_CATALOG = BRANDING_DESIGNS.join(", ");

/** How a directory that `setup` has not made a project is refused. */
const NOT_A_PROJECT_REFUSAL: Refusal = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; branding files live under .zitadel/.",
  next: ["setup"],
};

/**
 * How a retired `--design` is refused, by name, with a pointer to where page
 * layout lives, so scripts and agents that name `--design split` get an
 * actionable error instead of oclif's generic one.
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

/** Whether `value` names a retired design. */
function isRetiredDesign(value: string): boolean {
  return (RETIRED_BRANDING_DESIGNS as readonly string[]).includes(value);
}

/**
 * `zitadel branding eject` — take ownership of the login template.
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
export default class BrandingEject extends Suggestible(Promptable(BaseCommand)) {
  static override description =
    "Take ownership of the login template: scaffold .zitadel/branding/ from a shipped design.";
  static override group = CommandGroups.configuration;

  static override flags = {
    force: Flags.boolean({ char: "f", description: "Overwrite an existing branding file." }),
    // No oclif `options`: a retired design is refused by name, with a pointer
    // to where page layout lives, rather than by oclif's generic "expected one
    // of".
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
      return this.suggest(next);
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
    // The README and the editor's meta-schema are not configuration.
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

    // The descriptor and its template are configuration, written through it.
    const descriptor = Branding.create({
      path: DEFAULT_BRANDING_CONFIG_PATH,
      body: { $schema: BRANDING_FILE_SCHEMA_REF, ...branding },
    });
    const change = ZitadelConfig.empty()
      .branding.put(descriptor)
      .withText(DEFAULT_BRANDING_TEMPLATE_PATH, template);
    try {
      filesWritten.push(...(await change.save(new DiskStore(this.cwd), { overwrite: this.force })));
    } catch (error) {
      if (error instanceof FileExistsError) {
        throw new ZitadelError("E_CONFLICT", error.message, {
          hint: "Rerun with --force to replace it, or edit the existing file directly.",
          details: error.details,
        });
      }
      throw error;
    }

    // Never overwrite a hand-edited README.
    await write(
      join(CONFIG_DIRECTORIES.branding, "README.md"),
      normalizePublicCliProse(brandingReadmeContent(), this.cliVersion),
      false,
    ).catch(swallowConflict);
    // The descriptor's `$schema` must resolve to the dialect it was written
    // in, so the CLI-owned meta-schema is written when missing or outdated,
    // as `doctor --fix` does; one that cannot be read, or sits behind a
    // symlink, is doctor's to report.
    const brandingMeta = projectMetaSchemas(this.cliVersion).filter((file) => {
      return file.path === `${META_SCHEMA_DIR}/branding.json`;
    });
    const metaWrites = await writeMetaSchemas(this.cwd, brandingMeta, { dryRun: false });
    for (const artifact of metaWrites.written) {
      if (artifact.kind === "file") {
        filesWritten.push(artifact.path);
      }
    }

    for (const file of filesWritten) {
      log.info(`Wrote ${file}`);
    }
    const ejected = `Ejected the ${design} design into ${CONFIG_DIRECTORIES.branding}/`;

    return this.emit({
      status: "ok",
      data: {
        title: ejected,
        design,
        files_written: filesWritten,
      },
      summary: {
        title: ejected,
        sections: [],
        lines: [`Files: ${filesWritten.length} written, 0 unchanged`],
      },
      next: {
        actions: [
          `Edit ${DEFAULT_BRANDING_TEMPLATE_PATH} — the login UI is yours now.`,
          "Validate the template and see the diff with a dry run, then publish it.",
        ],
        commands: [this.suggest("deploy --dry-run"), this.suggest(DEPLOY_ARGS)],
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
