import { start } from "workflow/api";

import type { Runtime } from "./routes";
import { onboardingSystems, rpcSystems } from "./systems";
import { provisionAccount } from "./workflows/provision-account";
import { liveDirectory, zitadelServer } from "./zitadel";

/**
 * The routes' runtime on Vercel and under `next dev`: Zitadel read live as the
 * person calling, and workflows that start for real.
 */
export function workflowRuntime(request: Request): Runtime {
  return {
    systems: rpcSystems(liveDirectory(zitadelServer(request))),
    async provisionOnce(person, teams) {
      const { stripe } = onboardingSystems();
      const known = await Promise.all(teams.map((team) => stripe.hasCustomer(team)));
      if (teams.length > 0 && known.every(Boolean)) return false;
      await start(provisionAccount, [{ person, teams }]);
      return true;
    },
  };
}
