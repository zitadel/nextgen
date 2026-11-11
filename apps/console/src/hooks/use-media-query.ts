import { useSyncExternalStore } from "react";

import { subscribeMedia } from "@/lib/media-query";

/** Whether `query` matches the viewport, read synchronously and kept current. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMedia(window.matchMedia(query), onChange),
    () => window.matchMedia(query).matches,
    () => false,
  );
}
