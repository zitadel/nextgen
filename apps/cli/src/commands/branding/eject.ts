import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
import { BRANDING_FILE_SCHEMA_REF, META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";

import { BRANDING_DIR } from "../../lib/branding";
import { BRANDING_DESIGN_INFO } from "../../lib/branding/designs";
import { isErrno, ZitadelError } from "../../lib/errors";
import { stableStringify } from "../../lib/json";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { retiredDesignRule } from "./rules/retired-design";
import { unknownDesignRule } from "./rules/unknown-design";
import { isBrandingDesign } from "./design-catalog";
import { hasZitadelConfig } from "../../lib/project";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";

/** How a directory that `setup` has not made a project is refused. */
const NOT_A_PROJECT_REFUSAL: Refusal = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; branding files live under .zitadel/.",
  next: ["setup"],
};
import { metaSchemaState, projectMetaSchemas } from "../../lib/meta-schemas";
import { normalizePublicCliProse } from "../../lib/public-cli";
import { DEPLOY_ARGS } from "../../lib/release";
import { Promptable } from "../../lib/oclif/promptable";

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
  static override group = CommandGroups.configuration;
  static override flags = {
    force: Flags.boolean({ char: "f", description: "Overwrite an existing branding file." }),
    // No oclif `options`: the retired designs (#1039) must reach
    // brandingDesignRules to get their targeted error instead of oclif's
    // generic "expected one of".
    design: nonBlankString({
      description: `Design to start from: ${BRANDING_DESIGNS.join(" or ")} (default: ${DEFAULT_BRANDING_DESIGN}).`,
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  static override rules = [retiredDesignRule, unknownDesignRule];

  protected async execute({ flags }: Admitted<typeof BrandingEject>): Promise<JsonEnvelope> {
    if (!(await hasZitadelConfig(this.cwd))) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {}, (next) => {
        return this.suggestUnscoped(next);
      });
    }
    // The design rules have already refused one that is not a design, so a
    // value that survives them is either a design or absent, and absent is
    // asked for.
    const requested =
      flags.design !== undefined && isBrandingDesign(flags.design) ? flags.design : undefined;
    const design = requested ?? (await this.promptDesign(this.nonInteractive));
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
    consola.success(`Ejected the ${design} design into ${BRANDING_DIR}/`);

    return this.emit({
      status: "ok",
      data: {
        design,
        files_written: filesWritten,
      },
      next: {
        actions: [
          `Edit ${DEFAULT_BRANDING_TEMPLATE_PATH} — the login UI is yours now.`,
          "Deploy --dry-run validates the template and shows the diff; deploy publishes it.",
        ],
        // `branding eject` reads no environment, so it has no selector to
        // carry: the follow-ups run against whichever one the developer uses.
        commands: [this.suggestUnscoped("deploy --dry-run"), this.suggestUnscoped(DEPLOY_ARGS)],
      },
    });
  }

  private async promptDesign(nonInteractive: boolean): Promise<string> {
    if (nonInteractive) {
      return DEFAULT_BRANDING_DESIGN;
    }
    return this.input({
      kind: "select",
      name: "design",
      message: "Which design would you like to start from?",
      initialValue: DEFAULT_BRANDING_DESIGN as string,
      options: BRANDING_DESIGNS.map((design) => ({
        value: design as string,
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
