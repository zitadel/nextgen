import { dryRunResult } from "@/cli/core/crud/shared";
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

import { ZitadelError } from "@/lib/errors";
import { isErrno } from "@/lib/errno";
import { pathExists } from "@/lib/fs";
import { MetaSchemas } from "@/lib/meta-schemas";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { filled, reads } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { Spelling, WHAT_CHANGED } from "@/lib/suggestion";
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
import { Project } from "@/lib/project";
import { ServerCommand } from "@/cli/commands/server-command";
import { Promptable } from "@/cli/core/promptable";
import { Previewable } from "@/cli/core/previewable";
import { BaseCommand } from "@/cli/core";

/** The shipped designs, as a list for a hint to offer. */
const DESIGN_CATALOG = BRANDING_DESIGNS.join(", ");

/** How a directory that `setup` has not made a project is refused. */
const NOT_A_PROJECT_REFUSAL = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; branding files live under .zitadel/.",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

/**
 * How a retired `--design` is refused, by name, with a pointer to where page
 * layout lives, so scripts and agents that name `--design split` get an
 * actionable error instead of oclif's generic one.
 */
const RETIRED_DESIGN_REFUSAL = {
  message: "The {design} design was retired: it was page layout, not widget structure",
  hint: `${PAGE_LAYOUT_HINT} To own the widget's structure, eject one of: ${DESIGN_CATALOG}.`,
  next: [
    {
      id: "branding:eject",
      flags: { design: "centered" },
    },
  ],
} as const satisfies Refusal;

/**
 * How a `--design` that names no design, retired or shipped, is refused. The
 * value is quoted as it was typed: the envelope carries it raw, and the
 * terminal spells out an escape sequence in it rather than obeying it.
 */
const UNKNOWN_DESIGN_REFUSAL = {
  message: "Unknown design {design}",
  hint: `Pick one of: ${DESIGN_CATALOG}.`,
} as const satisfies Refusal;

/** Whether `value` names a design the CLI ships. */
function isBrandingDesign(value: string): value is BrandingDesign {
  return (BRANDING_DESIGNS as readonly string[]).includes(value);
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
export default class BrandingEject extends Promptable(Previewable(ServerCommand(BaseCommand))) {
  static override description =
    "Take ownership of the login template: scaffold .zitadel/branding/ from a shipped design.";
  static override group = CommandGroups.signIn;
  static override groupOrder = 4;

  /**
   * `--design` carries no oclif `options`: a retired design is refused by
   * name, with a pointer to where page layout lives, rather than by oclif's
   * generic "expected one of". Its `parse` accepts a design the CLI ships or
   * one that was retired, and refuses as unknown one that names neither. A
   * retired one is refused by name in `ejected`, where the follow-up it
   * suggests can carry the run's `--cwd`, which a refusal raised while the
   * flags parse has not read yet.
   */
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Overwrite an existing branding file.",
    }),
    design: Flags.custom<string>({
      parse: async (given, command, definition) => {
        const design = await reads({
          schema: filled,
          refusal: {
            message: "{input} was given an empty value",
            hint: "Pass a value for {input}, or omit it entirely.",
          },
        })(given, command, definition);
        if (
          !(RETIRED_BRANDING_DESIGNS as readonly string[]).includes(design) &&
          !isBrandingDesign(design)
        ) {
          throw refusalError(UNKNOWN_DESIGN_REFUSAL, { design: `"${design}"` });
        }
        return design;
      },
    })({
      description: `Design to start from: ${BRANDING_DESIGNS.join(" or ")} (default: ${DEFAULT_BRANDING_DESIGN}).`,
    }),
  };

  /**
   * Legacy: `--server` is accepted and ignored, so the run names no server.
   *
   * @returns No server.
   */
  protected override async resolveServer(): Promise<string> {
    return "";
  }

  /**
   * Says which files ejecting the design would write, without writing.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ flags }: Admitted<typeof BrandingEject>): Promise<CommandResult> {
    const { design, filesWritten, unchanged } = await this.ejected(flags, true);
    const result = dryRunResult({
      verb: "eject",
      topic: "design",
      noun: `the ${design} design into ${CONFIG_DIRECTORIES.branding}/`,
      next: await this.again("branding:eject", {
        without: ["dryRun"],
        with: { design },
      }),
    });

    return {
      ...result,
      pretty: undefined,
      data: {
        ...(result.data as object),
        design,
        files_would_write: filesWritten,
      },
      summary: {
        ...result.summary,
        lines: [
          `Files: ${filesWritten.length} would be written, ${unchanged} unchanged`,
          ...filesWritten.map((file) => {
            return `Would write ${escapeControlCharacters(file)}`;
          }),
        ],
      },
    };
  }

  /**
   * Ejects the design: writes the branding files into the project.
   *
   * @param input - The flags and arguments of the run.
   * @returns The envelope of the eject.
   */
  protected async apply({ flags }: Admitted<typeof BrandingEject>): Promise<CommandResult> {
    const { design, filesWritten, unchanged } = await this.ejected(flags, false);
    const title = `Ejected the ${design} design into ${CONFIG_DIRECTORIES.branding}/`;

    return {
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
          this.suggest({
            id: "deploy",
            flags: { dryRun: true },
          }),
          this.suggest({
            id: "deploy",
            flags: { message: WHAT_CHANGED },
          }),
        ],
      },
    };
  }

  /**
   * The checks and writes a dry run and the real run share: the refusals, and
   * the files each would write, which a dry run only lists. Once the checks
   * have refused a value that is not a design, what reaches the prompt is
   * either a design or absent, and absent is asked for. The descriptor and its
   * template are configuration, written through it; the README and the
   * editor's meta-schema are not, and are written directly. A hand-edited
   * README is never overwritten. The descriptor's `$schema` must resolve to the
   * dialect it was written in, so the CLI-owned meta-schema is written when
   * missing or outdated, as `doctor --fix` does; one that cannot be read, or
   * sits behind a symlink, is doctor's to report.
   *
   * @param flags - The run's `--design` and `--force`.
   * @param dryRun - Whether the files are only listed, never written.
   * @returns The design, the files written (or that would be), and how many stay as they are.
   */
  private async ejected(
    flags: { design: string | undefined; force: boolean | undefined },
    dryRun: boolean,
  ) {
    if (flags.design !== undefined && !isBrandingDesign(flags.design)) {
      throw refusalError(RETIRED_DESIGN_REFUSAL, { design: flags.design });
    }
    if (!(await Project.at(this.cwd).hasConfig())) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    const design =
      flags.design ??
      (this.nonInteractive
        ? DEFAULT_BRANDING_DESIGN
        : await this.ask.select({
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
          }));
    this.recordTelemetry({
      design,
      force: flags.force,
    });
    const { branding, template } = getDefaultBrandingConfig(design);

    const filesWritten: string[] = [];
    const write = async (relPath: string, content: string, overwrite: boolean): Promise<void> => {
      const dest = join(this.cwd, relPath);
      if (dryRun) {
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
      if (dryRun) {
        await change.check(new DiskStore(this.cwd), { overwrite: flags.force });
        filesWritten.push(...change.changedPaths);
      } else {
        filesWritten.push(
          ...(await change.save(new DiskStore(this.cwd), { overwrite: flags.force })),
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

    await write(
      join(CONFIG_DIRECTORIES.branding, "README.md"),
      Spelling.at(this.cliVersion).normalizeProse(brandingReadmeContent()),
      false,
    ).catch((error: unknown) => {
      if (error instanceof ZitadelError && error.code === "E_CONFLICT") {
        return;
      }
      throw error;
    });
    const brandingMeta = MetaSchemas.of(this.cliVersion).only((file) => {
      return file.path === `${META_SCHEMA_DIR}/branding.json`;
    });
    const metaWrites = await brandingMeta.write(this.cwd, { dryRun: dryRun });
    for (const artifact of metaWrites.written) {
      if (artifact.kind === "file") {
        filesWritten.push(artifact.path);
      }
    }

    const unchanged =
      change.changedPaths.length + 1 + brandingMeta.files.length - filesWritten.length;

    return {
      design,
      filesWritten,
      unchanged,
    };
  }
}
