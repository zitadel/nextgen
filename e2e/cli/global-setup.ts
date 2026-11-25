import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startBypassProxy } from "./support/bypass-proxy";
import { HARNESS_VARIABLE, type Harness, onProductionDomain } from "./support/cli";
import { installPackedCli } from "./support/packed-cli";

/**
 * Installs this commit's packed CLI into a directory of the run's, outside
 * the repository, and starts the bypass proxy when the deployment is behind
 * Vercel's protection; the teardown stops it and removes the directory.
 * Nothing on the production domain, where every test skips.
 */
export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  if (onProductionDomain()) {
    return undefined;
  }
  const deployment = new URL(process.env.CLOUD_URL ?? "");
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const dir = await mkdtemp(join(tmpdir(), "zitadel-cli-deployment-"));
  const bin = await installPackedCli(dir);
  // An http deployment (`pnpm run cloud`) has no protection to pass.
  const proxy =
    secret && deployment.protocol === "https:"
      ? await startBypassProxy({ deployment: deployment.origin, secret, dir })
      : undefined;
  const handed: Harness = {
    bin,
    dir,
    proxy: proxy && { url: proxy.url, certPath: proxy.certPath },
  };
  process.env[HARNESS_VARIABLE] = JSON.stringify(handed);
  return async () => {
    await proxy?.close();
    await rm(dir, { recursive: true, force: true });
  };
}
