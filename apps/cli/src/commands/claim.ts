import { Flags } from "@oclif/core";

import { createZitadelClient } from "@zitadel-nextgen/api/client";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { ZitadelError } from "../lib/errors";
import { readZitadelSecret, writeZitadelSecret } from "../lib/project";

/**
 * `zitadel claim` — hand an anonymous local project to a human owner.
 *
 * The CLI can start the claim challenge and later poll it, but the browser
 * claim ceremony owns the human sign-in/team choice. When status returns the
 * one-shot rotated project secret, this command atomically rewrites
 * `.zitadel/secret`.
 */
export default class Claim extends BaseCommand {
  static override description = "Claim an anonymous local project into a team.";
  static override flags = {
    "challenge-id": Flags.string({
      description: "Poll a claim challenge and rewrite .zitadel/secret after completion.",
    }),
    "return-url": Flags.string({
      description: "URL the browser claim flow should return to.",
    }),
    "team-name": Flags.string({
      description: "Suggested team name for the browser claim flow.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Claim);
    await this.toMeta(flags);
    const { cwd, source, dryRun } = this.meta;
    const secret = await readZitadelSecret(cwd);

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: {
          project_id: secret.project_id,
          challenge_id: flags["challenge-id"],
          action: flags["challenge-id"] ? "poll_claim_status" : "init_claim",
          message: "claim flow not started and .zitadel/secret unchanged",
        },
        nextCommands: flags["challenge-id"]
          ? [`zitadel claim --challenge-id ${flags["challenge-id"]}`]
          : ["zitadel claim"],
      });
    }

    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });

    if (flags["challenge-id"]) {
      const status = await client.getProjectClaimStatus(secret.project_id, {
        challenge_id: flags["challenge-id"],
      });
      if (status.status !== "completed" || !status.rotated_project_secret) {
        return this.emit({
          status: "ok",
          data: {
            project_id: secret.project_id,
            challenge_id: status.challenge_id,
            status: status.status,
            expires_at: status.expires_at,
            next_commands: [`zitadel claim --challenge-id ${status.challenge_id}`],
          },
        });
      }

      await writeZitadelSecret(cwd, {
        ...secret,
        project_secret: status.rotated_project_secret,
        lifecycle: "claimed",
        claimed_at: status.claimed_at,
      });
      return this.emit({
        status: "ok",
        data: {
          project_id: secret.project_id,
          challenge_id: status.challenge_id,
          status: "claimed",
          secret_rotated: true,
          next_commands: ["zitadel status"],
        },
      });
    }

    const claim = await client.initProjectClaim(
      secret.project_id,
      claimInitBody(flags["return-url"], flags["team-name"]),
    );

    if (!claim.claim_url) {
      throw new ZitadelError("E_VALIDATION", "Claim endpoint did not return a claim URL");
    }

    return this.emit({
      status: "ok",
      data: {
        project_id: secret.project_id,
        challenge_id: claim.challenge_id,
        claim_url: claim.claim_url,
        expires_at: claim.expires_at,
        status: claim.status,
        next_actions: ["Open the claim URL, then rerun claim with the challenge id."],
        next_commands: [`zitadel claim --challenge-id ${claim.challenge_id}`],
      },
    });
  }
}

function claimInitBody(returnUrl: string | undefined, teamName: string | undefined) {
  return {
    ...(returnUrl ? { return_url: returnUrl } : {}),
    ...(teamName ? { suggested_team_name: teamName } : {}),
  };
}
