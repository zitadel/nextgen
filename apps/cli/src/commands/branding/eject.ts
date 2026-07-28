import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { cancel, isCancel, select } from "@clack/prompts";
import { Flags } from "@oclif/core";
import { consola } from "consola";

import {
  BRANDING_DESIGNS,
  DEFAULT_BRANDING_CONFIG_PATH,
  DEFAULT_BRANDING_DESIGN,
  DEFAULT_BRANDING_TEMPLATE_PATH,
  brandingReadmeContent,
  getDefaultBrandingConfig,
} from "@zitadel/config/defaults";
import { BRANDING_FILE_SCHEMA_REF, META_SCHEMA_DIR, metaSchemaFiles } from "@zitadel/config/meta-schemas";

import { BRANDING_DIR } from "../../lib/branding";
import { ZitadelError } from "../../lib/errors";
import { stableStringify } from "../../lib/json";
import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { hasZitadelConfig } from "../../lib/project";
import { publicCliCommand } from "../../lib/public-cli";

/**
 * The `branding eject` command — take ownership of the login template.
 *
 * Scaffolds `.zitadel/branding/` from a shipped design: the `branding.json`
 * descriptor, the `login.liquid` template it references, a README, and the
 * branding dialect meta-schema (for projects set up before it existed).
 * Purely local — nothing is uploaded; the first `zitadel apply` publishes
 * revision 1. Ejecting the template is the last rung of the branding
 * override ladder (docs/design/branding/override-ladder.md); unrelated to
 * `zitadel eject`, which removes the Zitadel integration.
 */
export default class BrandingEject extends BaseCommand {
  static override description =
    "Take ownership of the login template: scaffold .zitadel/branding/ from a shipped design.";
  static override flags = {
    design: Flags.string({
      description: `Design to start from (default: ${DEFAULT_BRANDING_DESIGN}).`,
      options: [...BRANDING_DESIGNS],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(BrandingEject);
    await this.toMeta(flags);
    const { cwd, force, nonInteractive } = this.meta;

    if (!(await hasZitadelConfig(cwd))) {
      throw new ZitadelError("E_VALIDATION", "This directory is not a Zitadel project", {
        hint: "Run setup first; branding files live under .zitadel/.",
        nextCommands: [publicCliCommand("setup", this.meta.cliVersion)],
      });
    }

    const design = flags.design ?? (await this.promptDesign(nonInteractive));
    this.recordTelemetry({ design, force });
    const { branding, template } = getDefaultBrandingConfig(design);

    const filesWritten: string[] = [];
    const write = async (relPath: string, content: string, overwrite: boolean): Promise<void> => {
      const dest = join(cwd, relPath);
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
      force,
    );
    await write(DEFAULT_BRANDING_TEMPLATE_PATH, template, force);

    // Never overwrite a hand-edited README; setups from before the branding
    // dialect also miss the meta-schema, so materialize it when absent.
    await write(join(BRANDING_DIR, "README.md"), brandingReadmeContent(), false).catch(
      swallowConflict,
    );
    const brandingMeta = metaSchemaFiles().find((f) => f.name === "branding.json");
    if (brandingMeta) {
      await write(
        join(META_SCHEMA_DIR, brandingMeta.name),
        `${stableStringify(brandingMeta.body)}\n`,
        false,
      ).catch(swallowConflict);
    }

    for (const file of filesWritten) {
      consola.info(`Wrote ${file}`);
    }
    consola.success(`Ejected the ${design} design into ${BRANDING_DIR}/`);

    return this.emit({
      status: "ok",
      data: {
        design,
        files_written: filesWritten,
        next_actions: [
          `Edit ${DEFAULT_BRANDING_TEMPLATE_PATH} — the login UI is yours now.`,
          "Plan validates the template and shows the pending revision; apply publishes it.",
        ],
        next_commands: [
          publicCliCommand("plan", this.meta.cliVersion),
          publicCliCommand("apply", this.meta.cliVersion),
        ],
      },
    });
  }

  private async promptDesign(nonInteractive: boolean): Promise<string> {
    if (nonInteractive) {
      return DEFAULT_BRANDING_DESIGN;
    }
    const choice = await select({
      message: "Which design do you want to start from?",
      initialValue: DEFAULT_BRANDING_DESIGN as string,
      options: [
        { value: "centered", label: "Centered", hint: "the bundled default, card centred on page" },
        { value: "split", label: "Split", hint: "brand panel left, form right" },
        { value: "split-right", label: "Split (right)", hint: "form left, brand panel right" },
        { value: "hero", label: "Hero", hint: "landing-style brand pane left, form right" },
        { value: "minimal", label: "Minimal", hint: "no card chrome, fields straight on the page" },
      ],
    });
    if (isCancel(choice)) {
      cancel("Eject cancelled.");
      throw new ZitadelError("E_VALIDATION", "Eject cancelled by user");
    }
    return choice;
  }
}

function swallowConflict(error: unknown): void {
  if (error instanceof ZitadelError && error.code === "E_CONFLICT") {
    return;
  }
  throw error;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
