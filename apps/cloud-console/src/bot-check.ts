import { FLOW_WRITES } from "@zitadel/cloud-functions/contract";
import { initBotId } from "botid/client/core";

/**
 * BotID's client (root ADR 084 §5): it challenges the browser and marks the
 * sign-in widget's two flow writes, which the add-on routes through the
 * cloud's functions (`signInApiBase`), where `checkBotId()` reads the mark.
 * Started when the add-on loads, before the widget sends anything.
 *
 * The paths are the ones the widget sends: its base, then the API's prefix.
 * A call they miss goes unmarked, and the check refuses it as a bot.
 */
export function startBotCheck(): void {
  initBotId({ protect: [...FLOW_WRITES] });
}
