import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

usePlatformMock();

const PATTERN = "https://*-acmeinc.vercel.app";
const BRANCH_URL = "https://acme-git-sso-acmeinc.vercel.app";
const DEPLOY_URL = "https://acme-k3x9v2-acmeinc.vercel.app";

async function anAppAllowingPreviews(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  expect(await app.run(["allowlist", "add", PATTERN, "--kind", "preview", "--json"])).toSucceed();
  return app;
}

type Preview = { origins: string[]; deploy_id: string; ttl_seconds: number };

describe("preview", () => {
  it("deploys to the URLs the platform reports", async () => {
    const app = await anAppAllowingPreviews();

    const result = await app.run(["preview", "--non-interactive", "--json"], {
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: BRANCH_URL.replace("https://", ""),
      VERCEL_URL: DEPLOY_URL.replace("https://", ""),
    });

    expect(result).toSucceed();
    const { data } = app.envelopeOf<Preview>(result);
    expect(data.origins).toEqual([BRANCH_URL, DEPLOY_URL]);
    expect(data.deploy_id).toMatch(/^dpl_/);
    expect(data.ttl_seconds).toBe(604_800);
  });

  it("shows the preview as live with an expiry", async () => {
    const app = await anAppAllowingPreviews();
    expect(
      await app.run(["preview", "--non-interactive", "--json", "--origin", BRANCH_URL, "--ttl", "24h"]),
    ).toSucceed();

    const live = await app.run(["deployments", "--live", "--json"]);

    const rows = app.envelopeOf<{ deployments: Array<{ origin: string; expires_at?: string | null }> }>(live)
      .data.deployments;
    expect(rows.find((row) => row.origin === BRANCH_URL)?.expires_at).toBeTruthy();
  });

  it("does nothing in a production build", async () => {
    const app = await anAppAllowingPreviews();

    const result = await app.run(["preview", "--non-interactive", "--json"], {
      VERCEL_ENV: "production",
      VERCEL_URL: DEPLOY_URL.replace("https://", ""),
    });

    expect(result).toSucceed();
    expect(app.envelopeOf(result).status).toBe("skipped");
  });

  it("refuses a URL no preview pattern covers", async () => {
    const app = await aSetUpApp();

    const result = await app.run([
      "preview",
      "--non-interactive",
      "--json",
      "--origin",
      "https://evil.example",
    ]);

    expect(result).toFailWith("E_VALIDATION");
  });

  it("fails outside a platform build with nothing to target", async () => {
    const app = await anAppAllowingPreviews();

    expect(await app.run(["preview", "--non-interactive", "--json"])).toFailWith("E_VALIDATION");
  });

  it("retires a preview URL with preview rm", async () => {
    const app = await anAppAllowingPreviews();
    expect(
      await app.run(["preview", "--non-interactive", "--json", "--origin", BRANCH_URL]),
    ).toSucceed();

    expect(await app.run(["preview", "rm", BRANCH_URL, "--json"])).toSucceed();

    // The deployment records stay; only the row that admitted the URL is gone.
    expect(await app.run(["preview", "rm", BRANCH_URL, "--json"])).toFail();
  });
});
