import { z } from "zod";

import { filled, type Refused } from "@/cli/core/flags";
import { refusalError } from "@/cli/core/refusal";
import type { Questions } from "@/lib/ui";

import { PRESET_PROFILES, type Preset } from "./create-preset";

/** Sentinel for “Custom…” in a redirect or origin choice list. */
const CUSTOM = "__custom__" as const;

/**
 * Whether a host is loopback as the application schema allows: `localhost`, a
 * name under `.localhost`, or a loopback IP.
 */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

/**
 * Whether scheme is a private-use URI scheme for native apps (RFC 8252 §7.1),
 * matching the server's `isPrivateUseScheme`.
 */
function isPrivateUseScheme(scheme: string): boolean {
  if (scheme === "" || scheme === "http" || scheme === "https") {
    return false;
  }
  const [first, ...rest] = scheme;
  if (first === undefined || first < "a" || first > "z") {
    return false;
  }
  return rest.every((c) => {
    return (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "." || c === "+" || c === "-";
  });
}

/**
 * Whether a redirect URI is valid for the preset. Aligns with domain
 * `validateRedirectURI`: https, loopback http, or (native) a private-use
 * scheme with a path.
 *
 * @param value - The URI as typed.
 * @param preset - The client kind.
 * @returns Why it is refused, or undefined when it is fine.
 */
export function redirectUriProblem(value: string, preset: Preset): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "Enter a sign-in callback URL";
  }
  if (trimmed.includes("#")) {
    return "A redirect URI may not have a fragment";
  }
  const colon = trimmed.indexOf(":");
  if (colon <= 0) {
    return "Enter a full URL, starting with the scheme, e.g. com.acme.tunes:/callback";
  }
  const scheme = trimmed.slice(0, colon).toLowerCase();
  const rest = trimmed.slice(colon + 1);

  if (scheme === "http" || scheme === "https") {
    if (!URL.canParse(trimmed)) {
      return "Enter a full URL, starting with the scheme, e.g. https://app.example.com/callback";
    }
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:") {
      return undefined;
    }
    if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
      return undefined;
    }
    return "Sign-in callback must be an https URL, or http on localhost / 127.0.0.1";
  }

  if (preset !== "native") {
    return "Sign-in callback must be an https URL, or http on localhost / 127.0.0.1";
  }
  if (!isPrivateUseScheme(scheme)) {
    return "Sign-in callback must be https, loopback http, or a private-use scheme (e.g. com.acme.app:/callback)";
  }
  if (rest === "" || rest === "//") {
    return "A private-use redirect URI needs a path, e.g. com.acme.tunes:/callback";
  }
  return undefined;
}

/**
 * Whether an allowed origin is scheme+host[+port] with no path.
 *
 * @param value - The origin as typed.
 * @returns Why it is refused, or undefined when it is fine.
 */
export function originProblem(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "Enter an allowed origin";
  }
  if (!URL.canParse(trimmed)) {
    return "Enter an allowed origin such as http://localhost:5173";
  }
  const parsed = new URL(trimmed);
  if (parsed.pathname !== "/" || trimmed.includes("?") || trimmed.includes("#")) {
    return `An origin has no path. Use ${parsed.protocol}//${parsed.host} instead of ${trimmed}`;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "Enter an allowed origin such as http://localhost:5173";
  }
  return undefined;
}

/**
 * Flag-level redirect parse: accepts any URI any preset may use (native rules),
 * then {@link validatedRedirects} applies the chosen preset.
 */
export const REDIRECT_URI = {
  schema: filled.pipe(
    z.string().refine((value) => {
      return redirectUriProblem(value, "native") === undefined;
    }, "it is not a full URL"),
  ),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Pass a full URL, starting with the scheme.",
  },
} as const satisfies Refused<string>;

/** One allowed origin as a flag value. */
export const ORIGIN = {
  schema: filled.pipe(
    z.string().refine((value) => {
      return originProblem(value) === undefined;
    }, "it is not an origin"),
  ),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Pass a scheme and host only, for example http://localhost:5173.",
  },
} as const satisfies Refused<string>;

/** Options for {@link askSuggestedValue}. */
export type SuggestedValueAsk = Readonly<{
  name: string;
  message: string;
  flag: string;
  suggestions: readonly string[];
  already: readonly string[];
  alreadyProblem: string;
  alreadyHint: string;
  problem: (value: string) => string | undefined;
  normalize: (value: string) => string;
  invalidHint: string;
}>;

/**
 * Asks for one value from a suggestion list plus Custom…, with the same
 * duplicate and validation checks used for redirects and origins.
 *
 * @param ask - The command's questions.
 * @param opts - Suggestions, validation, and messages.
 * @returns The chosen, normalized value.
 */
export async function askSuggestedValue(ask: Questions, opts: SuggestedValueAsk): Promise<string> {
  const suggestions = opts.suggestions;
  const placeholder = suggestions[0] ?? "";
  const picked = await ask.select({
    name: opts.name,
    message: opts.message,
    flag: opts.flag,
    options: [
      ...suggestions.map((value) => {
        return { value, label: value };
      }),
      { value: CUSTOM, label: "Custom…" },
    ],
  });
  const raw =
    picked === CUSTOM
      ? await ask.text({
          name: opts.name,
          message: opts.message,
          flag: opts.flag,
          placeholder,
          parse: (value) => {
            const problem = opts.problem(value);
            if (problem !== undefined) {
              return { ok: false, problem };
            }
            const normalized = opts.normalize(value);
            if (opts.already.includes(normalized)) {
              return { ok: false, problem: opts.alreadyProblem };
            }
            return { ok: true, value: normalized };
          },
        })
      : opts.normalize(String(picked));
  if (opts.already.includes(raw)) {
    throw refusalError(
      {
        message: opts.alreadyProblem,
        hint: opts.alreadyHint,
      },
      {},
    );
  }
  const problem = opts.problem(raw);
  if (problem !== undefined) {
    throw refusalError(
      {
        message: problem,
        hint: opts.invalidHint,
      },
      {},
    );
  }
  return opts.normalize(raw);
}

/**
 * Validates flag redirect URIs for the preset.
 *
 * @param values - The URIs from `--redirect-uri`.
 * @param preset - The client kind.
 * @returns The URIs as a non-empty tuple.
 */
export function validatedRedirects(
  values: readonly string[],
  preset: Preset,
): readonly [string, ...string[]] {
  const uris: string[] = [];
  for (const value of values) {
    const problem = redirectUriProblem(value, preset);
    if (problem !== undefined) {
      throw refusalError(
        {
          message: problem,
          hint: "Fix --redirect-uri and run again.",
        },
        {},
      );
    }
    const trimmed = value.trim();
    if (uris.includes(trimmed)) {
      throw refusalError(
        {
          message: "That redirect URI is already listed",
          hint: "Pass each --redirect-uri only once.",
        },
        {},
      );
    }
    uris.push(trimmed);
  }
  const [first, ...rest] = uris;
  if (first === undefined) {
    throw refusalError(
      {
        message: "Missing required flag --redirect-uri (repeat for more)",
        hint: "Pass at least one --redirect-uri.",
      },
      {},
    );
  }
  return [first, ...rest];
}

/**
 * Validates flag origins.
 *
 * @param values - The origins from `--origin`.
 * @returns The origins.
 */
export function validatedOrigins(values: readonly string[]): readonly string[] {
  const origins: string[] = [];
  for (const value of values) {
    const problem = originProblem(value);
    if (problem !== undefined) {
      throw refusalError(
        {
          message: problem,
          hint: "Fix --origin and run again.",
        },
        {},
      );
    }
    origins.push(new URL(value.trim()).origin);
  }
  return origins;
}

/**
 * Asks for at least one redirect URI from a kind-based choice list, then
 * optional more.
 *
 * @param ask - The command's questions.
 * @param preset - The client kind, for suggestions and validation.
 * @returns The URIs.
 */
export async function askRedirects(
  ask: Questions,
  preset: Preset,
): Promise<readonly [string, ...string[]]> {
  const suggestions = PRESET_PROFILES[preset].redirectSuggestions;
  const first = await askSuggestedValue(ask, {
    name: "redirect URI",
    message: "Sign-in callback URL",
    flag: "--redirect-uri",
    suggestions,
    already: [],
    alreadyProblem: "That redirect URI is already listed",
    alreadyHint: "Pick a different callback URL.",
    problem: (value) => {
      return redirectUriProblem(value, preset);
    },
    normalize: (value) => {
      return value.trim();
    },
    invalidHint: "Pick a different callback URL.",
  });
  const uris = [first];
  while (
    await ask.yesNo({
      name: "another redirect URI",
      message: "Add another redirect URI?",
      initialValue: false,
    })
  ) {
    uris.push(
      await askSuggestedValue(ask, {
        name: "redirect URI",
        message: "Sign-in callback URL",
        flag: "--redirect-uri",
        suggestions,
        already: uris,
        alreadyProblem: "That redirect URI is already listed",
        alreadyHint: "Pick a different callback URL.",
        problem: (value) => {
          return redirectUriProblem(value, preset);
        },
        normalize: (value) => {
          return value.trim();
        },
        invalidHint: "Pick a different callback URL.",
      }),
    );
  }
  return uris as [string, ...string[]];
}

/**
 * Asks for at least one allowed origin, suggesting the first redirect's
 * origin, then optional more.
 *
 * @param ask - The command's questions.
 * @param firstRedirect - The first redirect URI, for a default suggestion.
 * @returns The origins.
 */
export async function askOrigins(
  ask: Questions,
  firstRedirect: string,
): Promise<readonly string[]> {
  const suggested = (() => {
    try {
      return new URL(firstRedirect).origin;
    } catch {
      return "http://localhost:5173";
    }
  })();
  const first = await askSuggestedValue(ask, {
    name: "allowed origin",
    message: "Allowed origin",
    flag: "--origin",
    suggestions: [suggested],
    already: [],
    alreadyProblem: "That origin is already listed",
    alreadyHint: "Pick a different origin.",
    problem: originProblem,
    normalize: (value) => {
      return new URL(value.trim()).origin;
    },
    invalidHint: "Pick a different origin.",
  });
  const origins = [first];
  while (
    await ask.yesNo({
      name: "another origin",
      message: "Add another origin?",
      initialValue: false,
    })
  ) {
    origins.push(
      await askSuggestedValue(ask, {
        name: "allowed origin",
        message: "Allowed origin",
        flag: "--origin",
        suggestions: [suggested],
        already: origins,
        alreadyProblem: "That origin is already listed",
        alreadyHint: "Pick a different origin.",
        problem: originProblem,
        normalize: (value) => {
          return new URL(value.trim()).origin;
        },
        invalidHint: "Pick a different origin.",
      }),
    );
  }
  return origins;
}
