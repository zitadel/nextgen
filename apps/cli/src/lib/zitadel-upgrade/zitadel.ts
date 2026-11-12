import { UpgradeTarget } from "@/lib/upgrade";

/** The Zitadel packages that move together, and the CLI whose dist-tag names the newest release. */
export const ZITADEL = new UpgradeTarget("@zitadel/", "@zitadel/cli");

/** The environment variable that, set to `0`, keeps a run off the npm registry. */
export const UPDATE_CHECK_VARIABLE = "ZITADEL_UPDATE_CHECK";
