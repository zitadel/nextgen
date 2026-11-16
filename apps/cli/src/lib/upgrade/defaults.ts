/**
 * The prefix of the Zitadel packages that move together as one release.
 */
export const ZITADEL_SCOPE = "@zitadel/";

/**
 * The environment variable that, set to `0`, keeps a run off the npm registry.
 */
export const UPDATE_CHECK_VARIABLE = "ZITADEL_UPDATE_CHECK";

/**
 * The page a person reads a release's notes on.
 */
export const RELEASE_NOTES_URL = "https://github.com/zitadel/nextgen/releases";

/**
 * The API the releases, with their notes, are listed from.
 */
export const RELEASES_API = "https://api.github.com/repos/zitadel/nextgen/releases?per_page=100";
