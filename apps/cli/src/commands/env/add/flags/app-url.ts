import { Flags } from "@oclif/core";
import type { Parsed } from "@zitadel/config/idp";

import { interpolate, type Refusal, refusalError } from "../../../../lib/oclif/refusal";

/** What an app URL is refused for: it must be an http(s) URL. */
export const APP_URL_REFUSAL: Refusal = {
  message: 'Invalid app URL "{value}"',
  hint: "Use a URL like https://app.acme.com.",
};

function isHttpUrl(value: string): boolean {
  return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
}

/**
 * What a person typed as the URL their app is served from, for a prompt's
 * `parse`: an empty answer is none, and anything else is an http(s) URL.
 */
export function readAppUrl(answer: string): Parsed<string | undefined> {
  const typed = answer.trim();
  if (typed === "") {
    return {
      ok: true,
      value: undefined,
    };
  }
  if (!isHttpUrl(typed)) {
    return {
      ok: false,
      problem: interpolate(APP_URL_REFUSAL.message, {
        value: typed,
      }),
    };
  }
  return {
    ok: true,
    value: typed,
  };
}

/**
 * A flag that holds the URL an app is served from, refused before the command
 * runs by {@link readAppUrl}: an empty value is no answer here, where a prompt
 * takes it as "none".
 */
export const appUrlFlag = Flags.custom<string>({
  parse: async (input) => {
    const parsed = readAppUrl(input);
    if (!parsed.ok || parsed.value === undefined) {
      throw refusalError(APP_URL_REFUSAL, {
        value: input,
      });
    }
    return parsed.value;
  },
});
