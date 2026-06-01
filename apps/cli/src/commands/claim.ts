import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { createPlatformClient } from "../platform";
import { readZitadelSecret, writeZitadelSecret } from "./shared";

export type ClaimOptions = GlobalOptions & {
  challengeId?: string;
  returnUrl?: string;
  teamName?: string;
};

export async function runClaim(io: CliIO, opts: ClaimOptions): Promise<void> {
  const secret = await readZitadelSecret(opts.cwd);
  if (opts.dryRun) {
    const action = opts.challengeId ? "poll_claim_status" : "init_claim";
    skipped(
      io,
      "dry run: claim flow not started and .zitadel/secret unchanged",
      opts,
      {
        project_id: secret.project_id,
        challenge_id: opts.challengeId,
        action,
      },
      opts.challengeId ? [`zitadel claim --challenge-id ${opts.challengeId}`] : ["zitadel claim"],
    );
    return;
  }

  const client = createPlatformClient(opts.source, secret.project_secret);

  if (opts.challengeId) {
    const status = await client.getProjectClaimStatus(secret.project_id, opts.challengeId);
    if (status.status !== "completed" || !status.rotated_project_secret) {
      ok(
        io,
        {
          project_id: secret.project_id,
          challenge_id: status.challenge_id,
          status: status.status,
          expires_at: status.expires_at,
          next_commands: [`zitadel claim --challenge-id ${status.challenge_id}`],
        },
        opts,
      );
      return;
    }

    await writeZitadelSecret(opts.cwd, {
      ...secret,
      project_secret: status.rotated_project_secret,
      lifecycle: "claimed",
      claimed_at: status.claimed_at,
    });
    ok(
      io,
      {
        project_id: secret.project_id,
        challenge_id: status.challenge_id,
        status: "claimed",
        secret_rotated: true,
        next_commands: ["zitadel status", "zitadel deploy connect --environment preview"],
      },
      opts,
    );
    return;
  }

  const claim = await client.initProjectClaim(secret.project_id, {
    return_url: opts.returnUrl,
    suggested_team_name: opts.teamName,
  });

  if (!claim.claim_url) {
    throw new ZitadelError("E_VALIDATION", "Claim endpoint did not return a claim URL");
  }

  ok(
    io,
    {
      project_id: secret.project_id,
      challenge_id: claim.challenge_id,
      claim_url: claim.claim_url,
      expires_at: claim.expires_at,
      status: claim.status,
      next_actions: ["Open the claim URL, then rerun claim with the challenge id."],
      next_commands: [`zitadel claim --challenge-id ${claim.challenge_id}`],
    },
    opts,
  );
}
