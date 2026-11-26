import { PM } from "@/lib/pm";
import { UpgradeInstallFailedError, UpgradeReleaseLookupError } from "@/lib/upgrade";

import type { Row } from "./row";

/** The install the upgrade ran. */
const INSTALL = PM.named("npm").addExact(["@zitadel/cli@2.0.0"]);

/** What the lookup of the newest release is refused with. */
const LOOKUP_MESSAGE = "Could not look up the latest release";

/** What a failed install is refused with. */
const INSTALL_MESSAGE = "Could not install the new packages";

/** What the package manager failed with. */
const INSTALL_CAUSE = "npm install failed with exit 1";

/** The errors of `@/lib/upgrade`, each with what main showed for it. */
export const UPGRADE_ROWS: readonly Row[] = [
  {
    error: new UpgradeReleaseLookupError(LOOKUP_MESSAGE),
    main: "lib/upgrade/upgrader.ts:92",
    deviation: {
      reason: "main's ReleaseLookupError class is now UpgradeReleaseLookupError",
      shown: {
        details: {
          original: { name: "UpgradeReleaseLookupError", message: LOOKUP_MESSAGE },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: LOOKUP_MESSAGE,
      details: {
        original: { name: "ReleaseLookupError", message: LOOKUP_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    error: new UpgradeInstallFailedError(INSTALL, new Error(INSTALL_CAUSE)),
    main: "lib/upgrade/installer.ts:95",
    deviation: {
      reason:
        "main's InstallError wrapper is gone; the original is the package manager's failure it wrapped",
      shown: {
        details: {
          original: { name: "Error", message: INSTALL_CAUSE },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: INSTALL_MESSAGE,
      details: {
        original: { name: "InstallError", message: INSTALL_MESSAGE },
      },
      exitCode: 3,
    },
  },
];
