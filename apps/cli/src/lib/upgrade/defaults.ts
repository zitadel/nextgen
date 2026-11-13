import { CLI_PACKAGE_NAME } from "@/lib/public-cli";

/**
 * The prefix of the Zitadel packages that move together as one release.
 */
export const ZITADEL_SCOPE = "@zitadel/";

/**
 * The package whose dist-tag names the newest Zitadel release.
 */
export const ZITADEL_CLI = CLI_PACKAGE_NAME;

/**
 * The environment variable that, set to `0`, keeps a run off the npm registry.
 */
export const UPDATE_CHECK_VARIABLE = "ZITADEL_UPDATE_CHECK";
