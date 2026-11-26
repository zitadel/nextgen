import { AbstractSanityCheck, CheckFailure, type CheckContext } from "./types";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { OrcaFrameworkMissingError, OrcaVersionBelowFloorError } from "@/lib/orca";
import { Project } from "@/lib/project";

/**
 * How the check fails for an app whose framework is older than the floor: the
 * version found, and the upgrade as its hint.
 */
const VERSION_BELOW_FLOOR_REFUSAL = {
  code: "E_UNSUPPORTED_PROJECT_SHAPE",
  message: "{message}",
  hint: "Upgrade the app to {displayName} {versionFloor} or later and rerun.{note}",
} as const satisfies Refusal;

/**
 * How the check fails for a directory with no app of a framework the CLI knows.
 */
const FRAMEWORK_MISSING_REFUSAL = {
  code: "E_FRAMEWORK_NOT_DETECTED",
  message: "{message}",
  hint: "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
} as const satisfies Refusal;

/** Verifies the framework detected on disk matches the one recorded in config. */
export class FrameworkCheck extends AbstractSanityCheck {
  readonly name = "framework";
  readonly path = "zitadel.json";
  protected readonly summary = "Detected framework matches recorded framework";

  /**
   * Compares the framework on disk with the one recorded in config.
   *
   * @param ctx - The directory and the detectors to read it with.
   * @returns Once the two match.
   * @throws {CheckFailure} When the detected framework is not the recorded one.
   * @throws {ZitadelError} When the app's framework is older than the floor, with the upgrade.
   */
  protected async verify(ctx: CheckContext): Promise<void> {
    const config = await Project.at(ctx.cwd).config();
    try {
      const detected = await ctx.orca.detect(ctx.cwd);
      const recorded = config.frameworkId;
      if (recorded !== detected.id) {
        throw new CheckFailure(`expected ${String(recorded)}, detected ${detected.id}`);
      }
    } catch (error) {
      if (error instanceof OrcaVersionBelowFloorError) {
        throw refusalError(VERSION_BELOW_FLOOR_REFUSAL, {
          message: error.message,
          displayName: error.displayName,
          versionFloor: error.versionFloor,
          note: error.note === undefined ? "" : ` ${error.note}`,
        });
      }
      if (error instanceof OrcaFrameworkMissingError) {
        throw refusalError(FRAMEWORK_MISSING_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
