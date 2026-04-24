import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { createPlatformClient } from "../platform";
import { readZitadelSecret } from "./shared";

export type ClaimOptions = GlobalOptions;

export async function runClaim(io: CliIO, opts: ClaimOptions): Promise<void> {
  const secret = await readZitadelSecret(opts.cwd);
  if (secret.claimed_at && secret.team_id) {
    skipped(
      io,
      "already-claimed",
      opts,
      {
        project_id: secret.project_id,
        lifecycle: "claimed",
        team_id: secret.team_id,
      },
      ["zitadel doctor"],
    );
    return;
  }

  const claim = await createPlatformClient(opts.source, secret.project_secret).initClaim(secret.project_id, {});
  ok(
    io,
    {
      title: "Zitadel claim handoff is ready.",
      project_id: secret.project_id,
      lifecycle: "pre-claim",
      handoff: "human",
      claim_url: claim.claim_url,
      challenge_id: claim.challenge_id,
      expires_at: claim.expires_at,
      next_actions: [
        "Open the claim URL in a browser and complete the human handoff.",
        "After claim completes, re-run `zitadel claim` or `zitadel doctor`.",
      ],
      next_commands: ["zitadel doctor"],
    },
    opts,
  );
}
