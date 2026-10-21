"use client";

import { useEffect } from "react";

/**
 * Unfolds the release a link points at (`/changelog#v1.0.0-alpha.25`): the
 * page folds every release but the newest (page.tsx).
 */
export function OpenLinkedRelease() {
  useEffect(() => {
    const open = () => {
      const release = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      const details = release?.querySelector("details");
      if (details) details.open = true;
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  return null;
}
