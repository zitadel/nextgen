import { dryRunResult } from "@/cli/core/crud/shared";

import { CommandGroups } from "@/cli/commands/groups";
import { BaseCommand, type CommandResult } from "@/cli/core";
import { Previewable } from "@/cli/core/previewable";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { Telemetered } from "@/cli/telemetry/telemetered";
import { Project } from "@/lib/project";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { CONFIG_DIRECTORIES, DiskStore, OAuthSettings, ZitadelConfig } from "@/lib/zitadel";

/** How a directory that `setup` has not made a project is refused. */
const NOT_A_PROJECT_REFUSAL = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; the OAuth settings live under .zitadel/.",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

/** The headline of a run that turned the switch on. */
const ENABLED = `Enabled the OAuth authorization server in ${OAuthSettings.PATH}`;

/** The headline of a run that found the switch already on. */
const ALREADY_ENABLED = "The OAuth authorization server is already enabled";

/**
 * `zitadel settings oauth enable` — turn the project's OAuth authorization
 * server on in the release.
 *
 * Writes `enabled: true` into the one settings file under `.zitadel/oauth/`,
 * creating it when there is none. Purely local — nothing is uploaded; the next
 * `zitadel deploy` ships it, and a release without the file leaves the
 * authorization server off.
 */
export default class SettingsOauthEnable extends Telemetered(Previewable(BaseCommand)) {
  static override description =
    "Turn the project's OAuth authorization server on: write the switch into .zitadel/oauth/.";
  static override group = CommandGroups.projectSettings;

  /**
   * Says whether enabling would write the settings file, without writing.
   *
   * @returns The dry run's envelope.
   */
  protected async preview(): Promise<CommandResult> {
    const written = await this.enabled(true);
    if (written === undefined) {
      return this.alreadyEnabled();
    }
    const result = dryRunResult({
      verb: "enable",
      topic: "OAuth",
      noun: `the OAuth authorization server in ${written}`,
      next: await this.again("settings:oauth:enable", { without: ["dryRun"] }),
    });
    return {
      ...result,
      pretty: undefined,
      data: { ...(result.data as object), file_would_write: written },
      summary: { ...result.summary, lines: [`Would write ${written}`] },
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
      return this.alreadyEnabled();
    }
    return {
      status: "ok",
      data: { title: ENABLED, file_written: written },
      summary: { title: ENABLED, sections: [], lines: [`Wrote ${written}`] },
      next: {
        actions: ["See the diff with a dry run, then publish the switch with the next release."],
        commands: [
          this.suggest({ id: "deploy", flags: { dryRun: true } }),
          this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } }),
        ],
      },
    };
  }

  /**
   * The checks and the write a dry run and the real run share: the settings
   * the project has get the switch set, keeping their path; a project without
   * any gets the one file. A broken settings file is refused as every command
   * that reads the configuration refuses one.
   *
   * @param dryRun - Whether the file is only checked, never written.
   * @returns The project-relative path written (or that would be), or
   *   `undefined` when the switch was already on.
   */
  private async enabled(dryRun: boolean): Promise<string | undefined> {
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
    const change = config.oauth.put(edit?.document ?? OAuthSettings.enabled());
    if (dryRun) {
      await change.check(store);
    } else {
      await change.save(store);
    }
    return change.changedPaths[0];
  }

  /**
   * The envelope of a run that found nothing to do, which `--json` reports as
   * skipped.
   *
   * @returns The envelope.
   */
  private alreadyEnabled(): CommandResult {
    return {
      status: "skipped",
      reason: "already-enabled",
      data: { title: ALREADY_ENABLED },
      summary: {
        title: ALREADY_ENABLED,
        sections: [],
        lines: [`${CONFIG_DIRECTORIES.oauth}/ already holds the switch, so nothing was written`],
      },
    };
  }
}
