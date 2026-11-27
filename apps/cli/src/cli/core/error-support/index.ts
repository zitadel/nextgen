import { BACKEND_WORDINGS } from "./backend";
import { CONSENT_WORDINGS } from "./consent";
import { ENVIRONMENT_WORDINGS } from "./environment";
import { FS_WORDINGS } from "./fs";
import { IDP_WORDINGS } from "./idp";
import { ORCA_WORDINGS } from "./orca";
import { PROJECT_WORDINGS } from "./project";
import { PUBLISH_WORDINGS } from "./publish";
import { SERVER_WORDINGS } from "./server";
import type { Wording } from "./wording";
import { ZITADEL_WORDINGS } from "./zitadel";

export { type Advice, derived, type Derived, type LibErrorClass, type Wording } from "./wording";

/**
 * Every lib package's wordings, one list. A wording advises exactly its
 * class, so their order does not matter.
 */
export const WORDINGS: readonly Wording[] = [
  ...BACKEND_WORDINGS,
  ...CONSENT_WORDINGS,
  ...ENVIRONMENT_WORDINGS,
  ...FS_WORDINGS,
  ...IDP_WORDINGS,
  ...ORCA_WORDINGS,
  ...PROJECT_WORDINGS,
  ...PUBLISH_WORDINGS,
  ...SERVER_WORDINGS,
  ...ZITADEL_WORDINGS,
];
