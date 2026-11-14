import { readPlatformRuntime } from "@/lib/local-server/runtime";

import { findLocalAdminFor } from "@/lib/local-server/admin-credential";
import { claimProjectAsAdmin } from "@/lib/local-server/claim-as-admin";
import { isCancellation, toZitadelError } from "@/lib/errors";
import { serverKind } from "@/lib/oclif/server-kind";
import { readZitadelSecret, writeZitadelSecret } from "@/lib/project";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "project">;

/**
 * Attaches the project to the local admin, on a local server that hosts the
 * platform plane.
 *
 * @remarks
 * On a CLI-managed local server the developer already exists as the local admin,
 * so the project is attached to their team right away and `zitadel claim` has
 * nothing left to do. Claiming an anonymous project stays a cloud journey. It is
 * best-effort: on failure the project stays unclaimed and setup falls back to
 * the usual claim nudge instead of failing after it has already written the app
 * files. A dry run contacts no platform.
 */
export class ClaimOwnership extends WizardStep<
  "ownership",
  Fact<"ownedByLocalAdmin" | "hostsPlatform" | "isLocal">,
  Needs,
  SetupServices
> {
  readonly key = "ownership";

  /**
   * Attach the project, when the server can.
   *
   * @param needs - The answers and the project.
   * @param services - What the command provides.
   * @returns Whom the project belongs to, and what kind of server it is on.
   */
  async run(
    needs: Needs,
    services: SetupServices,
  ): Promise<Fact<"ownedByLocalAdmin" | "hostsPlatform" | "isLocal">> {
    const { answers } = needs;
    const isLocal = serverKind.value(answers.server) === "local";
    const hostsPlatform =
      !services.dryRun && isLocal ? await localServerHostsPlatform(answers.server) : false;
    const ownedByLocalAdmin = hostsPlatform ? await this.attach(needs, services) : undefined;
    return {
      ownedByLocalAdmin,
      hostsPlatform,
      isLocal,
    };
  }

  /**
   * Attach the project to the local admin.
   *
   * @remarks
   * The runtime document naming the platform project does not prove a claim can
   * complete (a deployment can pin that project without the platform bootstrap,
   * which leaves the admin without a personal team), so a failure is a warning.
   * Reading the admin belongs inside the guard for the same reason: a malformed
   * `admin.json` must not fail a setup that already wrote the app.
   *
   *
   * The console lists only projects the signed-in person can manage, so an unattached project is
   * one the local admin never sees. A server started by hand has no local admin anywhere, hence the
   * "if".
   * @param needs - The answers and the project.
   * @param services - What the command provides.
   * @returns The admin and team the project now belongs to, or nothing.
   */
  private async attach(
    needs: Needs,
    services: SetupServices,
  ): Promise<Fact<"ownedByLocalAdmin">["ownedByLocalAdmin"]> {
    const { answers, project } = needs;
    try {
      const admin = await findLocalAdminFor(services.cwd, answers.server);
      if (!admin) {
        reportWarning(
          `No local admin for ${answers.server} in ${services.cwd} or its parents, so the project is not attached to a team and the local console will not list it. If ${services.suggest({ id: "start" })} started this server, run setup from the directory it ran in, or one inside it.`,
        );
        return undefined;
      }
      const owner = await claimProjectAsAdmin({
        serverUrl: answers.server,
        projectId: project.id,
        projectSecret: project.project_secret,
        admin,
        signal: services.signal,
      });
      // The team is whichever one the platform attached the project to — the
      // admin's earliest active membership, which need not be the team its
      // bootstrap document named.
      const secret = await readZitadelSecret(services.cwd);
      await writeZitadelSecret(services.cwd, {
        ...secret,
        team_id: owner.team_id,
        claimed_at: owner.claimed_at,
      });
      services.ui
        .begin("Attaching the project to the local admin")
        .done(
          `Project owned by ${escapeControlCharacters(admin.email)} (team ${escapeControlCharacters(owner.team_id)})`,
        );
      return {
        email: admin.email,
        team_id: owner.team_id,
      };
    } catch (error) {
      if (isCancellation(error) || services.signal.aborted) {
        throw error;
      }
      reportWarning(
        `Could not attach the project to the local admin: ${toZitadelError(error).message}`,
      );
      return undefined;
    }
  }
}

/**
 * Whether a local server hosts the platform plane, i.e. whether a claim
 * started against it can actually complete. `platform.bootstrap_project`
 * pins the deployment's default project to the well-known proj_platform, and
 * the console runtime document publishes that resolution, so one public GET
 * answers the question. Fail closed: an unreadable, absent, or hanging
 * document means no nudge, never a nudge into a flow that would 401 at
 * claim/complete — the timeout mirrors checkLocalServerHealth so a socket
 * that accepts and stalls cannot hang setup after the real work is done.
 * Exported so the fail-closed behavior is testable without a live server.
 */
export async function localServerHostsPlatform(server: string, timeoutMs = 1500): Promise<boolean> {
  return Boolean(await readPlatformRuntime(server, timeoutMs));
}
