declare const __ZITADEL_CLI_VERSION__: string;

export const CLI_VERSION: string =
  typeof __ZITADEL_CLI_VERSION__ !== "undefined" ? __ZITADEL_CLI_VERSION__ : "0.0.0";
