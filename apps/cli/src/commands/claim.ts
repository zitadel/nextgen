import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { createPlatformClient } from "../platform";
import type { ClaimStatusResponse } from "../platform/schemas";
import { MOCK_SENTINEL } from "../platform/resolve-server";
import { scaffold } from "../scaffolder";
import { readZitadelSecret, writeZitadelSecret, type ZitadelSecret } from "./shared";

export type ClaimOptions = GlobalOptions & {
  challengeId?: string;
  mockCompleteClaim?: boolean;
  mockAdvanceClaim?: boolean;
};

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

  const claim = await createPlatformClient(opts.source, secret.project_secret).initClaim(
    secret.project_id,
    {},
  );
  await scaffold(
    {
      ops: [
        {
          kind: "merge-json",
          path: ".zitadel/state.json",
          patch: {
            last_claim: {
              challenge_id: claim.challenge_id,
              claim_url: claim.claim_url,
              expires_at: claim.expires_at,
            },
          },
        },
      ],
      summary: [],
    },
    { cwd: opts.cwd, dryRun: opts.dryRun, force: true },
  );
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
        "After claim completes, run `zitadel claim status --challenge-id " +
          claim.challenge_id +
          "`.",
      ],
      next_commands: [`zitadel claim status --challenge-id ${claim.challenge_id}`],
    },
    opts,
  );
}

export async function runClaimStatus(io: CliIO, opts: ClaimOptions): Promise<void> {
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
        claimed_at: secret.claimed_at,
      },
      ["zitadel apply --environment production"],
    );
    return;
  }

  const challengeId = opts.challengeId ?? (await readLastChallengeId(opts.cwd));
  if (!challengeId) {
    throw new ZitadelError("E_VALIDATION", "zitadel claim status requires --challenge-id", {
      hint: "Run `zitadel claim` first, then pass the returned challenge_id.",
      nextCommands: ["zitadel claim"],
    });
  }

  const response = normalizeClaimStatus(
    opts.source === MOCK_SENTINEL && (opts.mockCompleteClaim || opts.mockAdvanceClaim)
      ? mockCompletedClaim(secret)
      : await createPlatformClient(opts.source, secret.project_secret).getClaimStatus(
          secret.project_id,
          challengeId,
        ),
  );

  if (response.status === "claimed") {
    const nextSecret: ZitadelSecret = {
      ...secret,
      project_secret: response.new_project_secret ?? secret.project_secret,
      claimed_at: response.claimed_at ?? new Date().toISOString(),
      team_id: response.team_id ?? "team_mock",
    };
    if (!opts.dryRun) {
      await writeZitadelSecret(opts.cwd, nextSecret);
    }
    ok(
      io,
      {
        title: "Zitadel project claimed.",
        project_id: secret.project_id,
        lifecycle: "claimed",
        status: response.status,
        team_id: nextSecret.team_id,
        claimed_at: nextSecret.claimed_at,
        dashboard_url: response.dashboard_url,
        state_refreshed: !opts.dryRun,
        next_commands: ["zitadel apply --environment production"],
      },
      opts,
    );
    return;
  }

  ok(
    io,
    {
      title:
        response.status === "expired"
          ? "Zitadel claim handoff expired."
          : "Zitadel claim is pending.",
      project_id: secret.project_id,
      lifecycle: "pre-claim",
      status: response.status,
      challenge_id: challengeId,
      next_commands:
        response.status === "expired"
          ? ["zitadel claim"]
          : [`zitadel claim status --challenge-id ${challengeId}`],
    },
    opts,
  );
}

async function readLastChallengeId(cwd: string): Promise<string | undefined> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const state = JSON.parse(await readFile(join(cwd, ".zitadel/state.json"), "utf8")) as {
      last_claim?: { challenge_id?: string };
    };
    return state.last_claim?.challenge_id;
  } catch {
    return undefined;
  }
}

function mockCompletedClaim(secret: ZitadelSecret): ClaimStatusResponse {
  return {
    status: "claimed",
    new_project_secret: `${secret.project_secret}_claimed`,
    team_id: "team_mock",
    claimed_at: "2026-04-21T14:15:11.000Z",
    dashboard_url: `https://zitadel.cloud/projects/${secret.project_id}`,
    tier: "free",
  };
}

function normalizeClaimStatus(response: ClaimStatusResponse): ClaimStatusResponse {
  if ((response as { status: string }).status === "completed") {
    return { ...response, status: "claimed" };
  }
  return response;
}
