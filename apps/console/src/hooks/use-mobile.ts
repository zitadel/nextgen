import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function readIsMobile(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia(MOBILE_QUERY).matches
}

/** Subscribe to a MediaQueryList with the legacy addListener fallback. */
function subscribeMedia(mql: MediaQueryList, onChange: () => void): () => void {
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }
  mql.addListener(onChange)
  return () => mql.removeListener(onChange)
}

export function useIsMobile() {
  // Seed from matchMedia synchronously so the first paint matches the viewport
  // (avoids a desktop-sidebar flash on small screens before the effect runs).
  const [isMobile, setIsMobile] = React.useState(readIsMobile)

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    return subscribeMedia(mql, onChange)
  }, [])

  return isMobile
}
