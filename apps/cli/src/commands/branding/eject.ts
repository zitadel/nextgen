import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Flags } from "@oclif/core";
import {
  BRANDING_DESIGNS,
  type BrandingDesign,
  brandingReadmeContent,
  DEFAULT_BRANDING_CONFIG_PATH,
  DEFAULT_BRANDING_DESIGN,
  DEFAULT_BRANDING_TEMPLATE_PATH,
  getDefaultBrandingConfig,
} from "@zitadel/config/defaults";
import { BRANDING_FILE_SCHEMA_REF, META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";

import { isErrno, ZitadelError } from "@/lib/errors";
import { pathExists } from "@/lib/fs";
import { projectMetaSchemas, writeMetaSchemas } from "@/lib/meta-schemas";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { filled, reads } from "@/lib/oclif/flags";
import { Promptable } from "@/lib/oclif/promptable";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { hasZitadelConfig } from "@/lib/project";
import { normalizePublicCliProse } from "@/lib/public-cli";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import {
  Branding,
  BRANDING_DESIGN_INFO,
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
  next: [{ id: "setup" }],
};

/**
 * How a retired `--design` is refused, by name, with a pointer to where page
 * layout lives, so scripts and agents that name `--design split` get an
 * actionable error instead of oclif's generic one.
 */
const RETIRED_DESIGN_REFUSAL: Refusal = {
  message: "The {design} design was retired: it was page layout, not widget structure",
  hint: `${PAGE_LAYOUT_HINT} To own the widget's structure, eject one of: ${DESIGN_CATALOG}.`,
  next: [{ id: "branding:eject", flags: { design: "centered" } }],
};

/**
 * How a `--design` that names no design, retired or shipped, is refused. The
 * value is quoted as it was typed: the envelope carries it raw, and the
 * terminal spells out an escape sequence in it rather than obeying it.
 */
const UNKNOWN_DESIGN_REFUSAL: Refusal = {
  message: "Unknown design {design}",
  hint: `Pick one of: ${DESIGN_CATALOG}.`,
};

/**
 * The `parse` of `--design`: a design the CLI ships or one that was retired,
 * and as unknown where it names neither. A retired one is refused by name in
 * `execute`, where the follow-up it suggests can carry the run's `--cwd`,
 * which a refusal raised while the flags parse has not read yet.
 */
async function readsDesign(
  given: string,
  command: unknown,
  definition: { name: string },
): Promise<string> {
  const design = await reads<string>({
    schema: filled,
    refusal: {
      message: "{input} was given an empty value",
      hint: "Pass a value for {input}, or omit it entirely.",
    },
  })(given, command, definition);
  if (!isRetiredDesign(design) && !isBrandingDesign(design)) {
    throw refusalError(UNKNOWN_DESIGN_REFUSAL, { design: `"${design}"` });
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
export default class BrandingEject extends Promptable(BaseCommand) {
  static override description =
    "Take ownership of the login template: scaffold .zitadel/branding/ from a shipped design.";
  static override group = CommandGroups.configuration;

  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Overwrite an existing branding file.",
    }),
    // No oclif `options`: a retired design is refused by name, with a pointer
    // to where page layout lives, rather than by oclif's generic "expected one
    // of".
    design: Flags.custom<string>({
      parse: readsDesign,
    })({
      description: `Design to start from: ${BRANDING_DESIGNS.join(" or ")} (default: ${DEFAULT_BRANDING_DESIGN}).`,
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  protected async execute({ flags }: Admitted<typeof BrandingEject>): Promise<JsonEnvelope> {
    if (flags.design !== undefined && !isBrandingDesign(flags.design)) {
      throw refusalError(RETIRED_DESIGN_REFUSAL, { design: flags.design });
    }
    if (!(await hasZitadelConfig(this.cwd))) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    // The checks above refused one that is not a design, so a value that got
    // here is either a design or absent, and absent is asked for.
    const design = flags.design ?? (await this.promptDesign(this.nonInteractive));
    this.recordTelemetry({
      design,
      force: this.force,
    });
    const { branding, template } = getDefaultBrandingConfig(design);

    const filesWritten: string[] = [];
    // The README and the editor's meta-schema are not configuration.
    const write = async (relPath: string, content: string, overwrite: boolean): Promise<void> => {
      const dest = join(this.cwd, relPath);
      if (this.dryRun) {
        if (overwrite || !(await pathExists(dest))) {
          filesWritten.push(relPath);
        }
        return;
      }
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
      body: {
        $schema: BRANDING_FILE_SCHEMA_REF,
        ...branding,
      },
    });
    const change = ZitadelConfig.empty()
      .branding.put(descriptor)
      .withText(DEFAULT_BRANDING_TEMPLATE_PATH, template);
    try {
      if (this.dryRun) {
        await change.check(new DiskStore(this.cwd), { overwrite: this.force });
        filesWritten.push(...change.changedPaths);
      } else {
        filesWritten.push(
          ...(await change.save(new DiskStore(this.cwd), { overwrite: this.force })),
        );
      }
    } catch (error) {
      if (error instanceof FileExistsError) {
        throw new ZitadelError("E_CONFLICT", error.message, {
          hint: "Rerun with --force to replace it, or edit the existing file directly.",
          nextCommands: [await this.again("branding:eject", { with: { design, force: true } })],
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
    const metaWrites = await writeMetaSchemas(this.cwd, brandingMeta, { dryRun: this.dryRun });
    for (const artifact of metaWrites.written) {
      if (artifact.kind === "file") {
        filesWritten.push(artifact.path);
      }
    }

    const unchanged = change.changedPaths.length + 1 + brandingMeta.length - filesWritten.length;
    if (this.dryRun) {
      const wouldTitle = `Would eject the ${design} design into ${CONFIG_DIRECTORIES.branding}/ (dry run)`;

      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          title: wouldTitle,
          design,
          files_would_write: filesWritten,
        },
        summary: {
          title: wouldTitle,
          sections: [],
          lines: [
            `Files: ${filesWritten.length} would be written, ${unchanged} unchanged`,
            ...filesWritten.map((file) => {
              return `Would write ${escapeControlCharacters(file)}`;
            }),
          ],
        },
        next: {
          commands: [await this.again("branding:eject", { without: ["dryRun"], with: { design } })],
        },
      });
    }

    const title = `Ejected the ${design} design into ${CONFIG_DIRECTORIES.branding}/`;

    return this.emit({
      status: "ok",
      data: {
        title,
        design,
        files_written: filesWritten,
      },
      summary: {
        title,
        sections: [],
        lines: [
          `Files: ${filesWritten.length} written, ${unchanged} unchanged`,
          ...filesWritten.map((file) => {
            return `Wrote ${escapeControlCharacters(file)}`;
          }),
        ],
      },
      next: {
        actions: [
          `Edit ${DEFAULT_BRANDING_TEMPLATE_PATH} — the login UI is yours now.`,
          "Validate the template and see the diff with a dry run, then publish it.",
        ],
        commands: [
          this.suggest({ id: "deploy", flags: { dryRun: true } }),
          this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } }),
        ],
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
      options: BRANDING_DESIGNS.map((design) => {
        return {
          value: design,
          label: BRANDING_DESIGN_INFO[design].label,
          hint: BRANDING_DESIGN_INFO[design].hint,
        };
      }),
    });
  }
}

function swallowConflict(error: unknown): void {
  if (error instanceof ZitadelError && error.code === "E_CONFLICT") {
    return;
  }
  throw error;
}
