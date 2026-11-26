import { isCancellation, ZitadelError, ZitadelLibError } from "@/lib/errors";
import { AdminClaim } from "@/lib/claim";
import { AdminSession, LocalRuntime, ZitadelRuntime } from "@/lib/server";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { warnings } from "@/lib/ui";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { Project } from "@/lib/project";

/**
 * How long to wait for the runtime document that says whether the server hosts the platform.
 */
const PLATFORM_RUNTIME_TIMEOUT_MS = 1500;

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "project">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "signal" | "suggest" | "ui">;

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
  Needs
> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "ownership";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Attach the project, when the server can.
   *
   * @remarks
   * The runtime document naming the platform project does not prove a claim can
   * complete (a deployment can pin that project without the platform bootstrap,
   * which leaves the admin without a personal team), so a failure is a warning.
   * Reading the admin belongs inside the guard for the same reason: a malformed
   * `admin.json` must not fail a setup that already wrote the app.
   *
   * Whether the server hosts the platform plane, which is whether a claim started against it can
   * complete: `platform.bootstrap_project` pins the deployment's default project to the well-known
   * proj_platform, and the console runtime document publishes that resolution, so one public GET
   * answers the question. It fails closed: an unreadable, absent, or hanging document means no
   * nudge, never a nudge into a flow that would 401 at claim/complete. The timeout mirrors
   * checkLocalServerHealth so a socket that accepts and stalls cannot hang setup after the real
   * work is done.
   *
   * The console lists only projects the signed-in person can manage, so an unattached project is
   * one the local admin never sees. A server started by hand has no local admin anywhere, hence the
   * "if".
   *
   * The team is whichever one the platform attached the project to: the admin's earliest active
   * membership, which need not be the team its bootstrap document named.
   *
   * @param needs - The answers and the project.
   * @returns Whom the project belongs to, and what kind of server it is on.
   */
  async run(needs: Needs): Promise<Fact<"ownedByLocalAdmin" | "hostsPlatform" | "isLocal">> {
    const { answers, project } = needs;
    const isLocal = ZitadelRuntime.fromUrl(answers.server).kind === "local";
    const hostsPlatform =
      !this.deps.dryRun &&
      isLocal &&
      Boolean(await LocalRuntime.readPlatform(answers.server, PLATFORM_RUNTIME_TIMEOUT_MS));
    if (!hostsPlatform) {
      return {
        ownedByLocalAdmin: undefined,
        hostsPlatform,
        isLocal,
      };
    }
    try {
      const admin = await LocalRuntime.findAdminFor(this.deps.cwd, answers.server);
      if (!admin) {
        warnings.report(
          `No local admin for ${answers.server} in ${this.deps.cwd} or its parents, so the project is not attached to a team and the local console will not list it. If ${this.deps.suggest({ id: "start" })} started this server, run setup from the directory it ran in, or one inside it.`,
        );
        return {
          ownedByLocalAdmin: undefined,
          hostsPlatform,
          isLocal,
        };
      }
      const session = new AdminSession(answers.server, admin, this.deps.signal);
      const owner = await new AdminClaim(
        answers.server,
        this.deps.signal,
        () => {
          return session.cookie();
        },
        (headers) => {
          return session.request(headers);
        },
      ).attach({
        projectId: project.id,
        projectSecret: project.project_secret,
      });
      const secret = await Project.at(this.deps.cwd).secret();
      await secret.with({ team_id: owner.team_id, claimed_at: owner.claimed_at }).write();
      this.deps.ui
        .begin("Attaching the project to the local admin")
        .done(
          `Project owned by ${escapeControlCharacters(admin.email)} (team ${escapeControlCharacters(owner.team_id)})`,
        );
      return {
        ownedByLocalAdmin: {
          email: admin.email,
          team_id: owner.team_id,
        },
        hostsPlatform,
        isLocal,
      };
    } catch (error) {
      if (this.deps.signal.aborted) {
        throw error;
      }
      if (error instanceof ZitadelLibError) {
        warnings.report(`Could not attach the project to the local admin: ${error.message}`);
        return {
          ownedByLocalAdmin: undefined,
          hostsPlatform,
          isLocal,
        };
      }
      if (error instanceof ZitadelError) {
        if (isCancellation(error)) {
          throw error;
        }
        warnings.report(`Could not attach the project to the local admin: ${error.message}`);
        return {
          ownedByLocalAdmin: undefined,
          hostsPlatform,
          isLocal,
        };
      }
      throw error;
    }
  }
}
