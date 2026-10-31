import { start } from "workflow/api";

import type { Runtime } from "./routes";
import { onboardingSystems, rpcSystems } from "./systems";
import { provisionBilling } from "./workflows/provision-billing";
import { provisionCrm } from "./workflows/provision-crm";
import { liveDirectory, zitadelServer } from "./zitadel";

/**
 * The people, with their teams, whose CRM onboarding this instance started:
 * a page load starts it once per instance. Its run looks up what exists
 * before it writes, so another instance starting it again changes nothing.
 */
const crmStarted = new Set<string>();

/**
 * The routes' runtime on Vercel and under `next dev`: Zitadel read live as the
 * person calling, and workflows that start for real.
 */
export function workflowRuntime(request: Request): Runtime {
  return {
    systems: rpcSystems(liveDirectory(zitadelServer(request))),
    async provisionOnce(person, teams, attribution) {
      const crmKey = [person.user_id, ...teams.map((team) => team.id).sort()].join(" ");
      const crm = !crmStarted.has(crmKey);
      if (crm) {
        await start(provisionCrm, [person, teams, attribution]);
        crmStarted.add(crmKey);
      }
      // Stripe is asked only once the CRM's run has started, so HubSpot never
      // waits on its answer, nor fails with it.
      const { stripe } = onboardingSystems();
      const customers = await Promise.all(teams.map((team) => stripe.hasCustomer(team)));
      const billing = !customers.every(Boolean);
      if (billing) await start(provisionBilling, [person, teams]);
      return crm || billing;
    },
  };
}
