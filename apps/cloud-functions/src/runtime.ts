import { start } from "workflow/api";

import type { Runtime } from "./routes";
import { currentSystems } from "./systems";
import { provisionAccount } from "./workflows/provision-account";

/** The routes' runtime on Vercel and under `next dev`: workflows start for real. */
export function workflowRuntime(): Runtime {
  const systems = currentSystems();
  return {
    systems,
    async provisionOnce(person, teams, consent) {
      const known = await Promise.all(teams.map((team) => systems.stripe.hasCustomer(team)));
      if (teams.length > 0 && known.every(Boolean)) return false;
      await start(provisionAccount, [{ person, teams, consent }]);
      return true;
    },
  };
}
