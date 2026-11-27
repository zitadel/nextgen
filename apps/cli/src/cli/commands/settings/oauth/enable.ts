import { dryRunResult } from "@/cli/core/crud/shared";
import { META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";

import { CommandGroups } from "@/cli/commands/groups";
import { BaseCommand, type CommandResult } from "@/cli/core";
import { Previewable } from "@/cli/core/previewable";
import { refuseOutsideProject } from "@/cli/core/not-a-project";
import { Telemetered } from "@/cli/telemetry/telemetered";
import { MetaSchemas } from "@/lib/meta-schemas";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { CONFIG_DIRECTORIES, DiskStore, OAuthSettings, ZitadelConfig } from "@/lib/zitadel";

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
    const { file, switched, written } = await this.enabled(true);
    const lines = written.map((path) => {
      return `Would write ${path}`;
    });
    if (!switched) {
      const title = `${ALREADY_ENABLED} (dry run)`;
      return {
        status: "ok",
        data: {
          title,
          dry_run: true,
          ...(written.length === 0 ? {} : { files_would_write: written }),
        },
        summary: {
          title,
          sections: [],
          lines: written.length > 0 ? lines : [SettingsOauthEnable.NOTHING_TO_WRITE],
        },
      };
    }
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
      summary: { ...result.summary, lines },
    };
  }

  /**
   * Turns the switch on: writes the settings file into the project.
   *
   * @returns The envelope of the run.
   */
  protected async apply(): Promise<CommandResult> {
    const { file, switched, written } = await this.enabled(false);
    if (written.length === 0) {
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
    const lines = written.map((path) => {
      return `Wrote ${path}`;
    });
    if (!switched) {
      // The switch was on, but its meta-schema was missing or outdated.
      return {
        status: "ok",
        data: { title: ALREADY_ENABLED, files_written: written },
        summary: { title: ALREADY_ENABLED, sections: [], lines },
      };
    }
    const title = `Enabled the OAuth authorization server in ${file}`;
    return {
      status: "ok",
      data: { title, files_written: written },
      summary: { title, sections: [], lines },
      next: {
        actions: ["See the diff with a dry run, then publish the switch with the next release."],
        commands: [
          this.suggest({ id: "deploy", flags: { dryRun: true } }),
          this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } }),
        ],
      },
    };
  }

  /** What a run that finds nothing to write says it left alone. */
  private static readonly NOTHING_TO_WRITE =
    `${CONFIG_DIRECTORIES.oauth}/ already holds the switch, so nothing was written`;

  /**
   * The checks and the writes a dry run and the real run share: the settings
   * the project has get the switch set, keeping their path; a project without
   * any gets the one file. A broken settings file, or a second one, is refused
   * as `deploy` refuses it. The settings' `$schema` must resolve to the
   * dialect they were written in, so the CLI-owned meta-schema is written
   * when missing or outdated, as `doctor --fix` does, also when the switch
   * was already on.
   *
   * @param dryRun - Whether the files are only checked, never written.
   * @returns The settings file's path, whether the switch was turned on, and
   *   the project-relative paths written (or that would be), the settings
   *   file first when it was.
   */
  private async enabled(dryRun: boolean): Promise<{
    readonly file: string;
    readonly switched: boolean;
    readonly written: readonly string[];
  }> {
    await refuseOutsideProject(this.cwd, "the OAuth settings live under .zitadel/.");
    const store = new DiskStore(this.cwd);
    const config = (await ZitadelConfig.loadKinds(store, ["oauth"]))
      .refuseBroken(store)
      .refuseSecondOAuth();
    const existing = config.oauth.all[0];
    const edit = existing === undefined ? undefined : existing.withEnabled(true);
    const document = edit?.document ?? OAuthSettings.enabled();
    const switched = edit?.changed !== false;
    if (switched) {
      const change = config.oauth.put(document);
      if (dryRun) {
        await change.check(store);
      } else {
        await change.save(store);
      }
    }
    const meta = MetaSchemas.of(this.cliVersion).only((file) => {
      return file.path === `${META_SCHEMA_DIR}/oauth-settings.json`;
    });
    const metaWrites = await meta.write(this.cwd, { dryRun });
    const metaPaths = metaWrites.written.flatMap((artifact) => {
      return artifact.kind === "file" ? [artifact.path] : [];
    });
    return {
      file: document.path,
      switched,
      written: switched ? [document.path, ...metaPaths] : metaPaths,
    };
  }
}
