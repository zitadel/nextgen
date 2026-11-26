import {
  IdpProviderUnknownError,
  IdpSettingsInvalidError,
  IdpSettingsMissingError,
  IdpSettingsUnusedError,
} from "@/lib/idp";

import type { Row } from "./row";

/** A complete command line that describes a custom connection. */
const EXAMPLE =
  "zitadel setup --sso custom --sso-slug acme --sso-display-name Acme --sso-issuer https://login.acme.com";

/** The providers the command takes. */
const KNOWN = ["google", "github", "custom"] as const;

/** The errors of `@/lib/idp`, each with what main showed for it. */
export const IDP_ROWS: readonly Row[] = [
  {
    error: new IdpSettingsInvalidError("--sso-issuer", "must be an https URL"),
    main: "lib/idp/custom.ts:258",
    expected: {
      code: "E_VALIDATION",
      message: "--sso-issuer: must be an https URL",
      hint: "Fix --sso-issuer and run the command again.",
      details: { flag: "--sso-issuer" },
      exitCode: 3,
    },
  },
  {
    case: "one setting beside a catalog provider",
    error: new IdpSettingsUnusedError(["--sso-slug"], "--sso"),
    main: "lib/idp/custom.ts:329",
    expected: {
      code: "E_VALIDATION",
      message: "--sso-slug only applies to a custom connection",
      hint: "Add --sso custom, or remove it.",
      details: { flags: ["--sso-slug"] },
      exitCode: 3,
    },
  },
  {
    case: "several settings beside a catalog provider",
    error: new IdpSettingsUnusedError(["--sso-slug", "--sso-issuer"], "--sso"),
    main: "lib/idp/custom.ts:329",
    expected: {
      code: "E_VALIDATION",
      message: "--sso-slug, --sso-issuer only applies to a custom connection",
      hint: "Add --sso custom, or remove them.",
      details: { flags: ["--sso-slug", "--sso-issuer"] },
      exitCode: 3,
    },
  },
  {
    error: new IdpSettingsMissingError(["--sso-display-name", "--sso-issuer"], EXAMPLE),
    main: "lib/idp/custom.ts:354",
    expected: {
      code: "E_VALIDATION",
      message: "A custom connection needs --sso-display-name, --sso-issuer",
      hint: `Describe the connection, e.g. ${EXAMPLE}`,
      details: { missing: ["--sso-display-name", "--sso-issuer"] },
      exitCode: 3,
    },
  },
  {
    error: new IdpProviderUnknownError("okta", KNOWN),
    main: "lib/idp/custom.ts:341",
    expected: {
      code: "E_VALIDATION",
      message: "Unknown provider okta",
      hint: "Use one of google, github, custom.",
      exitCode: 3,
    },
  },
];
