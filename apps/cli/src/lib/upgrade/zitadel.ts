import { UpgradeTarget } from "./upgrade-target";

/** Zitadel: the one fact `lib/upgrade` is told about what it upgrades. */
export const ZITADEL = new UpgradeTarget("@zitadel/", "@zitadel/cli", "ZITADEL_UPDATE_CHECK");
