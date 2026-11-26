import { BACKEND_WORDINGS } from "./backend";
import { BROWSER_WORDINGS } from "./browser";
import { CONSENT_WORDINGS } from "./consent";
import { ENVIRONMENT_WORDINGS } from "./environment";
import { FS_WORDINGS } from "./fs";
import { GIT_WORDINGS } from "./git";
import { IDP_WORDINGS } from "./idp";
import { ORCA_WORDINGS } from "./orca";
import { PM_WORDINGS } from "./pm";
import { PROJECT_WORDINGS } from "./project";
import { PUBLISH_WORDINGS } from "./publish";
import { SERVER_WORDINGS } from "./server";
import { SYNC_WORDINGS } from "./sync";
import { UPGRADE_WORDINGS } from "./upgrade";
import type { Wording } from "./wording";
import { ZITADEL_WORDINGS } from "./zitadel";

export { derived, type Derived, type LibErrorClass, type Wording } from "./wording";

/**
 * Every lib package's wordings, one list. No class of one package extends a
 * class of another, so each package's own order, most specific class first,
 * is all the order the lookup needs.
 */
export const WORDINGS: readonly Wording[] = [
  ...BACKEND_WORDINGS,
  ...BROWSER_WORDINGS,
  ...CONSENT_WORDINGS,
  ...ENVIRONMENT_WORDINGS,
  ...FS_WORDINGS,
  ...GIT_WORDINGS,
  ...IDP_WORDINGS,
  ...ORCA_WORDINGS,
  ...PM_WORDINGS,
  ...PROJECT_WORDINGS,
  ...PUBLISH_WORDINGS,
  ...SERVER_WORDINGS,
  ...SYNC_WORDINGS,
  ...UPGRADE_WORDINGS,
  ...ZITADEL_WORDINGS,
];
