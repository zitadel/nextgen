import { track as vercelTrack } from "@vercel/analytics";

import type { ConsoleAddon } from "@zitadel/console/addon";

/**
 * Sends each console event to Vercel Web Analytics with the header every
 * console event carries (docs/product-analytics-events.yaml): `surface`, the
 * commit the cloud deployed (`CONSOLE_VERSION`) and the cloud as the server.
 */
export const track: NonNullable<ConsoleAddon["track"]> = (event, properties) => {
  const version = import.meta.env.CONSOLE_VERSION;
  vercelTrack(event, {
    surface: "console",
    ...(version ? { console_version: version } : {}),
    server_kind: "cloud",
    ...properties,
  });
};
