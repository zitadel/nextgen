import { type Parsed, parseScopes } from "@zitadel/config/idp";

import type { Wizard } from "../wizard";

/** What every connection asks for, so it is stated rather than offered. */
const ALWAYS_ASKED = ["openid", "profile", "email"] as const;

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const refuse = (problem: string): Parsed<never> => ({ ok: false, problem });

/** Printable ASCII except space, the double quote and the backslash. */
function isScopeCharacter(code: number): boolean {
  return code === 0x21 || (code >= 0x23 && code <= 0x5b) || (code >= 0x5d && code <= 0x7e);
}

/**
 * One scope as typed. OAuth 2.0 (RFC 6749, 3.3) defines a scope as a run of
 * printable characters without a space, a double quote or a backslash, so
 * that is what is checked. It must not already be asked for.
 */
export function parseScopeToken(value: string, taken: readonly string[]): Parsed<string> {
  const scope = value.trim();
  if (scope === "") {
    return refuse("Enter a scope.");
  }
  if (![...scope].every((char) => isScopeCharacter(char.charCodeAt(0)))) {
    return refuse(
      "A scope is one word of printable characters, without spaces, quotes or backslashes.",
    );
  }
  return taken.includes(scope) ? refuse(`"${scope}" is already asked for.`) : ok(scope);
}

/**
 * The scopes a custom connection asks its provider for, as the text `--scopes`
 * takes.
 *
 * Given on the command line they are only checked. Otherwise `openid`,
 * `profile` and `email` are stated as always asked for, and a person adds any
 * others the provider documents, one at a time, each checked as it is typed.
 * One at a time because a list typed into one line is easy to get wrong and
 * cannot be checked scope by scope.
 *
 * @param provider - How the provider is named in messages.
 */
export async function askScopes(
  wizard: Wizard,
  provider: string,
  given: string | undefined,
): Promise<string> {
  if (given !== undefined) {
    const scopes = await wizard.ask({
      kind: "text",
      name: "scopes",
      message: "Which scopes should be asked for?",
      parse: parseScopes,
      given,
    });
    return scopes.join(" ");
  }

  wizard.say(
    `"${provider}" is always asked for the scopes ${ALWAYS_ASKED.slice(0, -1).join(", ")} and ${ALWAYS_ASKED.at(-1)}.`,
  );
  const added: string[] = [];
  for (;;) {
    const more = await wizard.ask({
      kind: "select",
      name: "more scopes",
      message:
        added.length === 0
          ? "Would you like to ask for any additional scopes?"
          : "Would you like to ask for any more additional scopes?",
      options: [
        { value: false, label: "No" },
        { value: true, label: "Yes, add a scope" },
      ],
      initialValue: false,
    });
    if (!more) {
      break;
    }
    added.push(
      await wizard.ask({
        kind: "text",
        name: "scope",
        message: "Which scope should be added?",
        placeholder: "groups",
        parse: (value) => parseScopeToken(value, [...ALWAYS_ASKED, ...added]),
      }),
    );
  }
  return [...ALWAYS_ASKED, ...added].join(" ");
}
