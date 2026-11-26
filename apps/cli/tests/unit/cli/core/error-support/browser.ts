import { BrowserLaunchError } from "@/lib/browser";

import type { Row } from "./row";

/** What the `open` package rejects with when the desktop's opener is missing. */
const SPAWN_MESSAGE = "spawn xdg-open ENOENT";

/** The errors of `@/lib/browser`, each with what main showed for it. */
export const BROWSER_ROWS: readonly Row[] = [
  {
    error: new BrowserLaunchError(
      "Cannot start the browser opener",
      Object.assign(new Error(SPAWN_MESSAGE), { code: "ENOENT" }),
    ),
    main: "lib/browser.ts:95",
    deviation: {
      reason:
        "main never surfaced this (openBrowser swallowed it); the errno hint main's generic fallback would add is not reproduced",
      shown: {
        hint: undefined,
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: SPAWN_MESSAGE,
      hint: "A required file or directory is missing.",
      details: {
        original: { name: "Error", message: SPAWN_MESSAGE, code: "ENOENT" },
      },
      exitCode: 3,
    },
  },
];
