import { ZitadelError } from "../../errors";
import { isObject } from "../../json";

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

/**
 * Whether a property name reads as a credential. Splits snake_case,
 * kebab-case and camelCase alike, so `client_secret`, `api-key` and
 * `userToken` all match while `passwordless` — one word that merely starts the
 * same way — does not.
 */
export const isSecretKey = (key: string): boolean => {
  const words = key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return (
    words.some((word) => SECRET_WORDS.has(word)) ||
    SECRET_COMPOUNDS.some((compound) => words.join("").includes(compound))
  );
};

/** Where a credential can go without passing through the command line. */
export const SECRET_ROUTES = "--file <path>, or --file - to read the body from stdin";

/** Refuse a credential that reached the command line, naming a route that does not. */
export const refuseSecret = (key: string, source: string): never => {
  throw new ZitadelError(
    "E_VALIDATION",
    `Refusing to read "${key}" from ${source}: the command line is visible to other processes and is kept in shell history`,
    { hint: `Pass the body with ${SECRET_ROUTES}.`, details: { field: key } },
  );
};

/** The first credential-looking property anywhere in a body, if there is one. */
export const findSecretKey = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSecretKey(entry);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!isObject(value)) {
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (isSecretKey(key)) {
      return key;
    }
    const found = findSecretKey(nested);
    if (found) {
      return found;
    }
  }
  return undefined;
};

/**
 * A body with every credential-valued property masked. A body may legitimately
 * carry a secret when it arrives by `--file` or stdin, but `--dry-run` prints
 * what would be sent — to a terminal, and to whatever captures CI logs — so the
 * value must not travel with it.
 */
export const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      isSecretKey(key) ? "«redacted»" : redactSecrets(nested),
    ]),
  );
};
