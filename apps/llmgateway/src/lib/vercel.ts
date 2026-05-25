/**
 * Vercel environment-variable write-back.
 *
 * After a successful OAuth token refresh the gateway calls
 * {@link persistTokensToVercel} (fire-and-forget) so that the next cold
 * start reads a fresh access token from env instead of immediately triggering
 * another refresh call.
 *
 * Required env vars (both must be set; missing either disables write-back):
 *
 * - `VERCEL_TOKEN`      — a Vercel personal access token with read/write
 *                         access to project environment variables.
 * - `VERCEL_TEAM_ID`    — the Vercel team / organisation ID that owns the
 *                         project (e.g. `team_xxxx`).
 * - `VERCEL_PROJECT_ID` — the Vercel project ID (e.g. `prj_xxxx`).
 */

const VERCEL_API_ORIGIN = "https://api.vercel.com";

/**
 * Look up the IDs of the two token env vars and PATCH both with fresh values.
 *
 * Errors are swallowed — write-back is a best-effort optimisation; a failure
 * here must never break the in-flight gateway response.
 */
export async function persistTokensToVercel(
	accessToken: string,
	refreshToken: string,
	fetchImpl: typeof fetch = fetch,
	env: Partial<Record<string, string>> = process.env,
): Promise<void> {
	const token = env["VERCEL_TOKEN"];
	const teamId = env["VERCEL_TEAM_ID"];
	const projectId = env["VERCEL_PROJECT_ID"];

	if (!token || !teamId || !projectId) {
		return;
	}

	const authHeader = { authorization: `Bearer ${token}` };

	// List all env vars to find the IDs for the two we want to update.
	const listRes = await fetchImpl(
		`${VERCEL_API_ORIGIN}/v10/projects/${projectId}/env?teamId=${teamId}`,
		{ headers: authHeader },
	);
	if (!listRes.ok) {
		return;
	}

	const { envs } = (await listRes.json()) as {
		readonly envs: ReadonlyArray<{ readonly id: string; readonly key: string }>;
	};

	const updates: ReadonlyArray<{ readonly key: string; readonly value: string }> = [
		{ key: "ANTHROPIC_AUTH_TOKEN", value: accessToken },
		{ key: "ANTHROPIC_REFRESH_TOKEN", value: refreshToken },
	];

	await Promise.all(
		updates.map(async ({ key, value }) => {
			const envVar = envs.find((e) => e.key === key);
			if (!envVar) {
				return;
			}
			await fetchImpl(
				`${VERCEL_API_ORIGIN}/v10/projects/${projectId}/env/${envVar.id}?teamId=${teamId}`,
				{
					method: "PATCH",
					headers: { ...authHeader, "content-type": "application/json" },
					body: JSON.stringify({ value }),
				},
			);
		}),
	);
}
