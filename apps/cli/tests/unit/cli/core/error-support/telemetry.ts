import { TelemetryClientError, TelemetryHomeUnknownError } from "@/lib/telemetry";

import type { Row } from "./row";

/** What `os.homedir()` throws where the home directory cannot be found. */
const HOMEDIR_MESSAGE =
  "A system error occurred: uv_os_homedir returned ENOENT (no such file or directory)";

/** What the Mixpanel SDK throws when it cannot make a client. */
const INIT_MESSAGE = "The Mixpanel library needs a Mixpanel token: `init(token)`";

/** What the Mixpanel client throws when a send goes wrong. */
const SEND_MESSAGE = "Cannot read properties of undefined (reading 'track')";

/** The errors of `@/lib/telemetry`, each with what main showed for it. */
export const TELEMETRY_ROWS: readonly Row[] = [
  {
    error: new TelemetryHomeUnknownError(
      "Cannot find the home directory",
      Object.assign(new Error(HOMEDIR_MESSAGE), { name: "SystemError", code: "ERR_SYSTEM_ERROR" }),
    ),
    main: "lib/telemetry/identity.ts:75",
    expected: {
      code: "E_VALIDATION",
      message: HOMEDIR_MESSAGE,
      details: {
        original: { name: "SystemError", message: HOMEDIR_MESSAGE, code: "ERR_SYSTEM_ERROR" },
      },
      exitCode: 3,
    },
  },
  {
    case: "a client that could not be made",
    error: new TelemetryClientError("Cannot make the Mixpanel client", new Error(INIT_MESSAGE)),
    main: "lib/telemetry/mixpanel-sink.ts:41",
    expected: {
      code: "E_VALIDATION",
      message: INIT_MESSAGE,
      details: {
        original: { name: "Error", message: INIT_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    case: "a client that refused a send",
    error: new TelemetryClientError(
      "The Mixpanel client refused a send",
      new TypeError(SEND_MESSAGE),
    ),
    main: "lib/telemetry/mixpanel-sink.ts:88",
    expected: {
      code: "E_VALIDATION",
      message: SEND_MESSAGE,
      details: {
        original: { name: "TypeError", message: SEND_MESSAGE },
      },
      exitCode: 3,
    },
  },
];
