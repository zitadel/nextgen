import { dryRunResult } from "@/cli/core/crud/shared";
import { META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";

import { CommandGroups } from "@/cli/commands/groups";
import { BaseCommand, type CommandResult } from "@/cli/core";
import { Previewable } from "@/cli/core/previewable";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { Telemetered } from "@/cli/telemetry/telemetered";
import { MetaSchemas } from "@/lib/meta-schemas";
import { Project } from "@/lib/project";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { CONFIG_DIRECTORIES, DiskStore, OAuthSettings, ZitadelConfig } from "@/lib/zitadel";

/** How a directory that `setup` has not made a project is refused. */
const NOT_A_PROJECT_REFUSAL = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; the OAuth settings live under .zitadel/.",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

/** The headline of a run that found the switch already on. */
const ALREADY_ENABLED = "The OAuth authorization server is already enabled";

/**
 * `zitadel settings oauth enable` — turn the project's OAuth authorization
 * server on in the release.
 *
 * Writes `enabled: true` into the one settings file under `.zitadel/oauth/`,
 * creating it when there is none, and the dialect meta-schema its `$schema`
 * points at when the project's copy is missing or outdated. Purely local —
 * nothing is uploaded; the next `zitadel deploy` ships it, and a release
 * without the file leaves the authorization server off.
 */
export default class SettingsOauthEnable extends Telemetered(Previewable(BaseCommand)) {
  static override description =
    "Turn the project's OAuth authorization server on: write the switch into .zitadel/oauth/.";
  static override group = CommandGroups.projectSettings;

  /**
   * Says which files enabling would write, without writing.
   *
   * @returns The dry run's envelope.
   */
  protected async preview(): Promise<CommandResult> {
    const written = await this.enabled(true);
    if (written === undefined) {
      const title = `${ALREADY_ENABLED} (dry run)`;
      return {
        status: "ok",
        data: { title, dry_run: true },
        summary: { title, sections: [], lines: [SettingsOauthEnable.NOTHING_TO_WRITE] },
      };
    }
    const [file] = written;
    const result = dryRunResult({
      verb: "enable",
      topic: "OAuth",
      noun: `the OAuth authorization server in ${file}`,
      next: await this.again("settings:oauth:enable", { without: ["dryRun"] }),
    });
    return {
      ...result,
      pretty: undefined,
      data: { ...(result.data as object), files_would_write: written },
      summary: {
        ...result.summary,
        lines: written.map((path) => {
          return `Would write ${path}`;
        }),
      },
    };
  }

  /**
   * Turns the switch on: writes the settings file into the project.
   *
   * @returns The envelope of the run.
   */
  protected async apply(): Promise<CommandResult> {
    const written = await this.enabled(false);
    if (written === undefined) {
      return {
        status: "skipped",
        reason: "already-enabled",
        data: { title: ALREADY_ENABLED },
        summary: {
          title: ALREADY_ENABLED,
          sections: [],
          lines: [SettingsOauthEnable.NOTHING_TO_WRITE],
        },
      };
    }
    const [file] = written;
    const title = `Enabled the OAuth authorization server in ${file}`;
    return {
      status: "ok",
      data: { title, files_written: written },
      summary: {
        title,
        sections: [],
        lines: written.map((path) => {
          return `Wrote ${path}`;
        }),
      },
      next: {
        actions: ["See the diff with a dry run, then publish the switch with the next release."],
        commands: [
          this.suggest({ id: "deploy", flags: { dryRun: true } }),
          this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } }),
        ],
      },
    };
  }

  /** What a run that finds the switch on says it left alone. */
  private static readonly NOTHING_TO_WRITE =
    `${CONFIG_DIRECTORIES.oauth}/ already holds the switch, so nothing was written`;

  /**
   * The checks and the writes a dry run and the real run share: the settings
   * the project has get the switch set, keeping their path; a project without
   * any gets the one file. A broken settings file is refused as every command
   * that reads the configuration refuses one. The settings' `$schema` must
   * resolve to the dialect they were written in, so the CLI-owned meta-schema
   * is written when missing or outdated, as `doctor --fix` does.
   *
   * @param dryRun - Whether the files are only checked, never written.
   * @returns The project-relative paths written (or that would be), the
   *   settings file first, or `undefined` when the switch was already on.
   */
  private async enabled(dryRun: boolean): Promise<readonly [string, ...string[]] | undefined> {
    if (!(await Project.at(this.cwd).hasConfig())) {
      throw refusalError(NOT_A_PROJECT_REFUSAL, {});
    }
    const store = new DiskStore(this.cwd);
    const config = (await ZitadelConfig.loadKinds(store, ["oauth"])).refuseBroken(store);
    const existing = config.oauth.all[0];
    const edit = existing === undefined ? undefined : existing.withEnabled(true);
    if (edit?.changed === false) {
      return undefined;
    }
    const document = edit?.document ?? OAuthSettings.enabled();
    const change = config.oauth.put(document);
    if (dryRun) {
      await change.check(store);
    } else {
      await change.save(store);
    }
    const meta = MetaSchemas.of(this.cliVersion).only((file) => {
      return file.path === `${META_SCHEMA_DIR}/oauth-settings.json`;
    });
    const metaWrites = await meta.write(this.cwd, { dryRun });
    const metaPaths = metaWrites.written.flatMap((artifact) => {
      return artifact.kind === "file" ? [artifact.path] : [];
    });
    return [document.path, ...metaPaths];
  }
}
