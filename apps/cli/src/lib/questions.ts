import { parseClientId, parseClientSecret } from "@zitadel/config/idp";

/**
 * Questions that more than one command asks, so they read the same wherever
 * they come up. Each returns the parts every asker shares; the command adds
 * what is its own (`flag`, `given`, `stdin`, `retry`) when it passes the
 * question to `this.input`.
 *
 * The wording follows the rule in `apps/cli/AGENTS.md`: a polite question a
 * person can answer without knowing the CLI, never a bare field label such as
 * "Client ID". It says where the answer comes from or where it goes.
 */

/** The OAuth application's client id, which the provider's console shows. */
export function clientIdQuestion(provider: string) {
  return {
    kind: "text",
    name: `client id for ${provider}`,
    message: `What is the client ID of your ${provider} OAuth app?`,
    parse: parseClientId,
  } as const;
}

/**
 * The OAuth application's client secret. Where it ends up is said when the
 * project variable that holds it is known, because that is the part a person
 * would otherwise have to look up afterwards.
 */
export function clientSecretQuestion(options: { provider: string; variable?: string }) {
  const { provider, variable } = options;
  return {
    kind: "secret",
    name: variable === undefined ? "client secret" : `client secret for ${variable}`,
    message:
      variable === undefined
        ? `What is the client secret of your ${provider} OAuth app?`
        : `What is the client secret of your ${provider} OAuth app? It will be stored on the project as ${variable}.`,
    parse: parseClientSecret,
  } as const;
}
