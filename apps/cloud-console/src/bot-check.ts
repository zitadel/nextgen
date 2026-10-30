import { initBotId } from "botid/client/core";

/**
 * BotID's client (root ADR 084 §5): it challenges the browser and marks the
 * sign-in widget's two flow writes, which the add-on routes through the
 * cloud's functions (`signInApiBase`), where `checkBotId()` reads the mark.
 * Started when the add-on loads, before the widget sends anything.
 */
export function startBotCheck(): void {
  initBotId({
    protect: [
      { path: "/cloud/zitadel/flow", method: "POST" },
      { path: "/cloud/zitadel/flow/*/submit", method: "POST" },
    ],
  });
}
