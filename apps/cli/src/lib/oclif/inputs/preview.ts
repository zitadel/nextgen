import { Args, Flags } from "@oclif/core";

import { ZitadelError } from "../../errors";
import { parseTtl, type Ttl } from "../../ttl";
import { refuseBlank } from "../flags";
import { interpolate, type Refusal } from "../refusal";

const PREVIEW_KEYWORD_REFUSAL: Refusal = {
  message: "A preview cannot target the primary origins",
  hint: "Pass the preview URLs with --origin; production is deployed by `zitadel deploy`, after merge.",
};

const TTL_RANGE_REFUSAL: Refusal = {
  message: "{value} is outside the allowed range",
  hint: "A preview lives between 60s and 365d.",
};

const MINIMUM_TTL_MS = 60 * 1000;
const MAXIMUM_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function refuse(refusal: Refusal, values: Readonly<Record<string, unknown>>): ZitadelError {
  return new ZitadelError("E_VALIDATION", interpolate(refusal.message, values), {
    hint: refusal.hint === undefined ? undefined : interpolate(refusal.hint, values),
  });
}

/**
 * A preview URL given with `--origin`. An origin has no path, so a trailing
 * slash is dropped and one preview is one spelling. `primary` is the
 * deployment keyword for every primary origin, which a preview build must
 * never reach with its narrower credential, so it is refused.
 */
export const previewOriginFlag = Flags.custom<string>({
  parse: async (input, _command, flag) => {
    const url = withoutTrailingSlash(refuseBlank(input, `--${flag.name}`, "the value is empty"));
    if (url === "primary") {
      throw refuse(PREVIEW_KEYWORD_REFUSAL, {});
    }
    return url;
  },
});

/**
 * How long a preview stays live, as `7d`, `12h` or `90m`. A preview lives a
 * minute at least and 365 days at most, the server's fixed limit.
 */
export const previewTtlFlag = Flags.custom<Ttl>({
  parse: async (input) => {
    const ttl = parseTtl(input);
    if (ttl.ms < MINIMUM_TTL_MS || ttl.ms > MAXIMUM_TTL_MS) {
      throw refuse(TTL_RANGE_REFUSAL, {
        value: input,
      });
    }
    return ttl;
  },
});

/**
 * A preview URL given as an argument. A trailing slash names the same
 * origin; sent as typed it would match nothing.
 */
export const previewUrlArg = Args.custom<string>({
  parse: async (input, _command, arg) =>
    withoutTrailingSlash(refuseBlank(input, arg.name, `${arg.name} was given an empty value`)),
});
