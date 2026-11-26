import { GitBinaryMissingError, GitCommandFailedError, GitInternalError } from "@/lib/git";

import type { Row } from "./row";

/** What starting a git that is not on `PATH` reports. */
const SPAWN_MESSAGE = "spawn git ENOENT";

/** What git prints when a revision does not exist. */
const UNKNOWN_REVISION =
  "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.";

/** What git prints when it cannot read the repository. */
const DUBIOUS_OWNERSHIP = "fatal: detected dubious ownership in repository at '/work/app'";

/** What a commit that left no HEAD is refused with. */
const NO_HEAD = "the commit left no HEAD to record";

/** The errors of `@/lib/git`, each with what main showed for it. */
export const GIT_ROWS: readonly Row[] = [
  {
    error: new GitBinaryMissingError(SPAWN_MESSAGE),
    main: "lib/git/git.ts:140",
    expected: {
      code: "E_VALIDATION",
      message: SPAWN_MESSAGE,
      details: {
        original: { name: "GitDidNotStartError", message: SPAWN_MESSAGE },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main's git errors were internal Error classes that no longer exist; the typed class stands in and reports its own code",
      shown: {
        details: {
          original: { name: "GitBinaryMissingError", message: SPAWN_MESSAGE },
        },
      },
    },
  },
  {
    case: "a git command that exited non-zero",
    error: new GitCommandFailedError(UNKNOWN_REVISION),
    main: "lib/git/git.ts:157",
    expected: {
      code: "E_VALIDATION",
      message: UNKNOWN_REVISION,
      details: {
        original: { name: "RepositoryError", message: UNKNOWN_REVISION },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main's git errors were internal Error classes that no longer exist; the typed class stands in and reports its own code",
      shown: {
        details: {
          original: {
            name: "GitCommandFailedError",
            message: UNKNOWN_REVISION,
          },
        },
      },
    },
  },
  {
    case: "a git command that timed out",
    error: new GitCommandFailedError("git did not finish in time"),
    main: "lib/git/git.ts:148",
    expected: {
      code: "E_VALIDATION",
      message: "git did not finish in time",
      details: {
        original: { name: "RepositoryError", message: "git did not finish in time" },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main's git errors were internal Error classes that no longer exist; the typed class stands in and reports its own code",
      shown: {
        details: {
          original: {
            name: "GitCommandFailedError",
            message: "git did not finish in time",
          },
        },
      },
    },
  },
  {
    case: "a repository git could not open",
    error: new GitCommandFailedError(DUBIOUS_OWNERSHIP),
    main: "lib/git/repository.ts:80",
    expected: {
      code: "E_VALIDATION",
      message: DUBIOUS_OWNERSHIP,
      details: {
        original: { name: "RepositoryError", message: DUBIOUS_OWNERSHIP },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main's git errors were internal Error classes that no longer exist; the typed class stands in and reports its own code",
      shown: {
        details: {
          original: {
            name: "GitCommandFailedError",
            message: DUBIOUS_OWNERSHIP,
          },
        },
      },
    },
  },
  {
    error: new GitInternalError(NO_HEAD),
    main: "lib/git/operations/commit-all.ts:96",
    expected: {
      code: "E_VALIDATION",
      message: NO_HEAD,
      details: {
        original: { name: "RepositoryError", message: NO_HEAD },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main's git errors were internal Error classes that no longer exist; the typed class stands in and reports its own code",
      shown: {
        details: { original: { name: "GitInternalError", message: NO_HEAD } },
      },
    },
  },
];
