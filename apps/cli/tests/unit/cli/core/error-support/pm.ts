import { JsonNotAnObjectError } from "@/lib/json";
import {
  PmCommandFailedError,
  PmCommandMissingError,
  PmCommandNotPermittedError,
  PmManifestInvalidError,
} from "@/lib/pm";

import type { Row } from "./row";

/** The `package.json` every pm row reads. */
const MANIFEST = "/work/app/package.json";

/** Why a pm row names the typed class where main named a bare `Error`. */
const TYPED = "main threw an anonymous Error; the branch names the typed class it threw instead";

/** The errors of `@/lib/pm`, each with what main showed for it. */
export const PM_ROWS: readonly Row[] = [
  {
    error: new PmManifestInvalidError(
      `${MANIFEST} must contain a JSON object`,
      new JsonNotAnObjectError(`${MANIFEST} must contain a JSON object`),
    ),
    main: "lib/json.ts:89",
    expected: {
      code: "E_VALIDATION",
      message: `${MANIFEST} must contain a JSON object`,
      details: {
        original: { name: "Error", message: `${MANIFEST} must contain a JSON object` },
      },
      exitCode: 3,
    },
    deviation: {
      reason: "main threw an anonymous Error; the branch's parse names its JsonNotAnObjectError",
      shown: {
        details: {
          original: {
            name: "JsonNotAnObjectError",
            message: `${MANIFEST} must contain a JSON object`,
          },
        },
      },
    },
  },
  {
    error: new PmCommandNotPermittedError("spawn npm EACCES", "EACCES"),
    main: "lib/pm/package-command.ts:153",
    expected: {
      code: "E_AUTH",
      message: "Permission denied: spawn npm EACCES",
      hint: "Check file permissions or run with the right user.",
      details: {
        original: { name: "Error", message: "spawn npm EACCES", code: "EACCES" },
      },
      exitCode: 1,
    },
    deviation: {
      reason: TYPED,
      shown: {
        details: {
          original: {
            name: "PmCommandNotPermittedError",
            message: "spawn npm EACCES",
            code: "EACCES",
          },
        },
      },
    },
  },
  {
    error: new PmCommandMissingError("spawn npm ENOENT", "ENOENT"),
    main: "lib/pm/package-command.ts:153",
    expected: {
      code: "E_VALIDATION",
      message: "spawn npm ENOENT",
      hint: "A required file or directory is missing.",
      details: {
        original: { name: "Error", message: "spawn npm ENOENT", code: "ENOENT" },
      },
      exitCode: 3,
    },
    deviation: {
      reason: TYPED,
      shown: {
        details: {
          original: { name: "PmCommandMissingError", message: "spawn npm ENOENT", code: "ENOENT" },
        },
      },
    },
  },
  {
    error: new PmCommandFailedError("npm install failed with exit 1", 1, "npm ERR! code E404"),
    main: "lib/pm/package-command.ts:160",
    expected: {
      code: "E_VALIDATION",
      message: "npm install failed with exit 1",
      details: {
        original: { name: "Error", message: "npm install failed with exit 1", code: 1 },
      },
      exitCode: 3,
    },
    deviation: {
      reason: TYPED,
      shown: {
        details: {
          original: {
            name: "PmCommandFailedError",
            message: "npm install failed with exit 1",
            code: 1,
          },
        },
      },
    },
  },
];
