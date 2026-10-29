import type { ConsoleAddon } from "@zitadel/console/addon";

import { track } from "./analytics";
import { startBotCheck } from "./bot-check";
import { CloudRoot } from "./cloud-root";
import { billingScreen } from "./screens/billing";
import { emailScreen } from "./screens/email";
import { supportScreen } from "./screens/support";
import { VercelInsights } from "./vercel-insights";

/**
 * What waits for its functions to go live or for its check on a preview
 * (root ADR 083 §9): previews and local runs get it, production keeps
 * Vercel's insights alone. The build inlines the stage, so a production
 * bundle carries none of it.
 */
const unreleased = import.meta.env.CLOUD_STAGE !== "production";

if (unreleased) startBotCheck();

/**
 * The hosted cloud's add-on to the console (Console ADR 0006): what only the
 * cloud's console build carries, through the slots of the console's contract.
 * Vercel's insights and the account provisioning on every page; Billing,
 * Support and Email in Settings; and the sign-in widget's calls through the
 * functions' bot check. All backed by `apps/cloud-functions`.
 */
export const addon: ConsoleAddon = unreleased
  ? {
      Root: CloudRoot,
      track,
      screens: [billingScreen, supportScreen, emailScreen],
      signInApiBase: "/cloud/zitadel",
    }
  : { Root: VercelInsights, track };
