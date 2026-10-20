import { parseScopes } from "@zitadel/config/idp";

import type { Asker } from "../input";

import { parseScopeList } from "./claims";

/** The scopes OpenID Connect defines, with what each one makes a provider send. */
const STANDARD_SCOPES = [
  { value: "openid", label: "openid", hint: "required: it makes the provider send an ID token" },
  { value: "profile", label: "profile", hint: "name, picture, locale and similar" },
  { value: "email", label: "email", hint: "email and whether it is verified" },
  { value: "phone", label: "phone", hint: "phone number and whether it is verified" },
  { value: "address", label: "address", hint: "postal address" },
  { value: "offline_access", label: "offline_access", hint: "a refresh token" },
] as const;

/** What a connection asks for unless told otherwise. */
const DEFAULT_CHOICES = ["openid", "profile", "email"];

/**
 * The scopes a custom connection asks its provider for, as the text `--scopes`
 * takes.
 *
 * Given on the command line they are only checked. Otherwise a person ticks the
 * standard ones, then adds any the provider documents beyond them (`groups`,
 * `employee`). `openid` is always asked for: without it the provider sends no
 * ID token.
 *
 * @param provider - How the provider is named in the question.
 */
export async function askScopes(
  ask: Asker,
  provider: string,
  given: string | undefined,
): Promise<string> {
  if (given !== undefined) {
    return (
      await ask({
        kind: "text",
        name: "scopes",
        message: "Which scopes should be asked for?",
        parse: parseScopes,
        given,
      })
    ).join(" ");
  }
  const chosen = await ask({
    kind: "multiselect",
    name: "scopes",
    message: `Which scopes should "${provider}" be asked for?`,
    options: STANDARD_SCOPES.map((scope) => ({ ...scope })),
    initialValues: DEFAULT_CHOICES,
    required: true,
  });
  const extra = await ask({
    kind: "text",
    name: "additional scopes",
    message: "Would you like to ask for any additional scopes? Leave blank for none.",
    placeholder: "groups employee",
    parse: parseScopeList,
  });
  const scopes = parseScopes(["openid", ...chosen, ...extra].join(" "));
  if (!scopes.ok) {
    throw new Error(scopes.problem);
  }
  return scopes.value.join(" ");
}
