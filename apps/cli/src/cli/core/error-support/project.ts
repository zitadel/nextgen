import { ProjectConfigMissingError, ProjectSecretMissingError } from "@/lib/project";

import type { Advice, Wording } from "./wording";

/** How a project with no `zitadel.json` is refused. */
const CONFIG_MISSING_ADVICE = {
  next: [
    {
      id: "setup",
    },
  ],
} as const satisfies Advice;

/** How a project with no `.zitadel/secret` is refused. */
const SECRET_MISSING_ADVICE = {
  hint: "Run `zitadel doctor --fix` to restore the project secret from .env.development.local.",
  next: [
    {
      id: "doctor",
      flags: {
        fix: true,
      },
    },
  ],
} as const satisfies Advice;

/** How the errors of `@/lib/project` are advised on, each for exactly its class. */
export const PROJECT_WORDINGS: readonly Wording[] = [
  [ProjectConfigMissingError, CONFIG_MISSING_ADVICE],
  [ProjectSecretMissingError, SECRET_MISSING_ADVICE],
];
