import { Args, Flags } from "@oclif/core";
import type { Parsed } from "@zitadel/config/idp";

import { isEnvironmentName } from "../../environment";
import { ZitadelError } from "../../errors";
import { interpolate, type Refusal } from "../refusal";

const ENVIRONMENT_NAME_REFUSAL: Refusal = {
  message: '"{value}" is not a usable environment name',
  hint: 'Use letters, digits, dot, dash and underscore, and no "..", e.g. production.',
};

const APP_URL_REFUSAL: Refusal = {
  message: 'Invalid app URL "{value}"',
  hint: "Use a URL like https://app.acme.com.",
};

function refuse(refusal: Refusal, value: string): ZitadelError {
  const values = {
    value,
  };
  return new ZitadelError("E_VALIDATION", interpolate(refusal.message, values), {
    hint: refusal.hint === undefined ? undefined : interpolate(refusal.hint, values),
  });
}

/** A positional argument that names an environment, usable in a `.env.<name>.local` file name. */
export const environmentNameArg = Args.custom<string>({
  parse: async (input) => {
    if (!isEnvironmentName(input)) {
      throw refuse(ENVIRONMENT_NAME_REFUSAL, input);
    }
    return input;
  },
});

function isHttpUrl(value: string): boolean {
  return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
}

/**
 * What a person typed as the URL their app is served from, for a prompt's
 * `parse`: an empty answer is none, and anything else is an http(s) URL.
 */
export function parseAppUrl(answer: string): Parsed<string | undefined> {
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

/** A flag that holds the URL an app is served from, refused unless it is an http(s) URL. */
export const appUrlFlag = Flags.custom<string>({
  parse: async (input) => {
    const parsed = parseAppUrl(input);
    if (!parsed.ok || parsed.value === undefined) {
      throw refuse(APP_URL_REFUSAL, input);
    }
    return parsed.value;
  },
});
