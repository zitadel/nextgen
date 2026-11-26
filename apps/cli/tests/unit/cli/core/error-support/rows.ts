import { BACKEND_ROWS } from "./backend";
import { BROWSER_ROWS } from "./browser";
import { CONSENT_ROWS } from "./consent";
import { ENVIRONMENT_ROWS } from "./environment";
import { FS_ROWS } from "./fs";
import { GIT_ROWS } from "./git";
import { IDP_ROWS } from "./idp";
import { ORCA_ROWS } from "./orca";
import { PM_ROWS } from "./pm";
import { PROJECT_ROWS } from "./project";
import { PUBLISH_ROWS } from "./publish";
import type { Row } from "./row";
import { SERVER_ROWS } from "./server";
import { SUGGESTION_ROWS } from "./suggestion";
import { SYNC_ROWS } from "./sync";
import { TELEMETRY_ROWS } from "./telemetry";
import { UPGRADE_ROWS } from "./upgrade";
import { WIZARD_ROWS } from "./wizard";
import { ZITADEL_ROWS } from "./zitadel";

/** Every lib package's rows, one list. */
export const ROWS: readonly Row[] = [
  ...BACKEND_ROWS,
  ...BROWSER_ROWS,
  ...CONSENT_ROWS,
  ...ENVIRONMENT_ROWS,
  ...FS_ROWS,
  ...GIT_ROWS,
  ...IDP_ROWS,
  ...ORCA_ROWS,
  ...PM_ROWS,
  ...PROJECT_ROWS,
  ...PUBLISH_ROWS,
  ...SERVER_ROWS,
  ...SUGGESTION_ROWS,
  ...SYNC_ROWS,
  ...TELEMETRY_ROWS,
  ...UPGRADE_ROWS,
  ...WIZARD_ROWS,
  ...ZITADEL_ROWS,
];
