/**
 * The project the demo signs its users in to: the one its widgets start flows
 * for. The proxy and `auth()` count a session only when it belongs to it.
 */
export const DEMO_PROJECT_ID = process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "proj_demo";
