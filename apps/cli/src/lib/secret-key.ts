/**
 * Names whose value is a credential. Anything on the command line — a flag
 * value, and equally `--data "$(cat body.json)"`, which the shell expands
 * before the CLI runs — is visible to other processes, kept in shell history,
 * and captured by CI logs. Only a named file or stdin keeps it out of argv,
 * so those are the routes the errors point at.
 */
const SECRET_WORDS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "credential",
  "credentials",
]);

/** Secret names that only read as such once their words are joined. */
const SECRET_COMPOUNDS = ["apikey", "privatekey", "accesskey", "secretkey"];

/** A name's words, whether it is spelled in snake_case, kebab-case or camelCase. */
export const wordsOf = (key: string): readonly string[] => {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => {
      return word.toLowerCase();
    });
};

/**
 * Whether a property name reads as a credential, so `client_secret`, `api-key`
 * and `userToken` all match while `passwordless` — one word that merely starts
 * the same way — does not. `token_endpoint` matches too: what lets its URL
 * through is the value, not the name.
 */
export const isSecretKey = (key: string): boolean => {
  const words = wordsOf(key);
  return (
    words.some((word) => {
      return SECRET_WORDS.has(word);
    }) ||
    SECRET_COMPOUNDS.some((compound) => {
      return words.join("").includes(compound);
    })
  );
};

/** Last words that say a credential-sounding name holds where a secret is, or how it is used, not the secret. */
const NOT_THE_SECRET: ReadonlySet<string> = new Set([
  "endpoint",
  "url",
  "uri",
  "file",
  "path",
  "var",
  "variable",
  "name",
  "ref",
  "reference",
  "id",
  "method",
  "algorithm",
  "length",
]);

/** Words in a name that make it a setting about credentials, as `--password-hash-params-time` is. */
const SETTING_WORDS: ReadonlySet<string> = new Set(["hash", "params", "min", "max", "policy"]);

/**
 * Whether a flag or argument holds a secret itself: its name reads as a
 * credential's ({@link isSecretKey}), and is not the name of an address, a
 * file, a variable or a setting about one (`--client-secret-file`,
 * `--oidc-token-endpoint`, `--password-min-length`,
 * `--password-hash-params-time`), nor a paging cursor
 * (`--page-token`), which is opaque and no credential.
 *
 * @param name - The flag or argument, as code or the command line spells it.
 * @returns Whether a value typed to it is a secret.
 */
export function isSecretFlag(name: string): boolean {
  const words = wordsOf(name);
  return (
    isSecretKey(name) &&
    !NOT_THE_SECRET.has(words.at(-1) ?? "") &&
    !words.some((word) => {
      return SETTING_WORDS.has(word);
    }) &&
    !(words.at(-2) === "page" && words.at(-1) === "token")
  );
}
