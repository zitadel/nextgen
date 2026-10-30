import type { ConsoleAddon } from "@zitadel/console/addon";

import { track } from "./analytics";
import { startBotCheck } from "./bot-check";
import { CloudRoot } from "./cloud-root";
import { billingScreen } from "./screens/billing";
import { emailScreen } from "./screens/email";
import { signUpScreen } from "./screens/sign-up";
import { supportScreen } from "./screens/support";
import { VercelInsights } from "./vercel-insights";

/**
 * What waits for its functions to go live or for its check on a preview
 * (root ADR 084 §9): previews and local runs get it, production does not.
 * Billing and Support are in both, since each shows its preview state while
 * the functions answer `cloud.not_live`; Email has none, as nothing sends
 * marketing email yet. Sign-up calls no function, so production has it too.
 * The build inlines the stage, so a production bundle carries none of what it
 * leaves out.
 */
const unreleased = import.meta.env.CLOUD_STAGE !== "production";

// BotID's client loads its challenge from paths only a Vercel deployment
// serves, so it starts in a preview's build alone. A local production build
// (`workspace:cloud`) would fail every flow write without the challenge,
// while the functions' check answers human outside Vercel anyway.
if (import.meta.env.CLOUD_STAGE === "preview") startBotCheck();

/**
 * The hosted cloud's add-on to the console (Console ADR 0006): what only the
 * cloud's console build carries, through the slots of the console's contract.
 * Vercel's insights and the account provisioning on every page; Billing,
 * Support and Email in Settings; the sign-up page; and the sign-in widget's
 * calls through the functions' bot check. All backed by `apps/cloud-functions`.
 */
export const addon: ConsoleAddon = unreleased
  ? {
      Root: CloudRoot,
      track,
      screens: [billingScreen, supportScreen, emailScreen],
      signedOutScreens: [signUpScreen],
      signInApiBase: "/cloud/zitadel",
    }
  : {
      Root: VercelInsights,
      track,
      screens: [billingScreen, supportScreen],
      signedOutScreens: [signUpScreen],
    };
