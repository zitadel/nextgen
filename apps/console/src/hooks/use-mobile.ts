import { useMediaQuery } from "./use-media-query";

const MOBILE_BREAKPOINT = 768;
/** Below the sidebar's breakpoint, where it becomes a sheet. */
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Read synchronously so the first paint matches the viewport (no desktop
 * sidebar flash on small screens before an effect runs).
 */
export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}
