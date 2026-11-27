import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  nativeApplication,
  spaApplication,
  webApplication,
} from "@zitadel/config/application-presets";

import type { SuggestedCommand } from "@/lib/suggestion";
import type { Questions } from "@/lib/ui";

/** Client kinds a person may pick on the wire (`--preset`). */
export const PRESET_IDS = ["web", "spa", "native"] as const;

export type Preset = (typeof PRESET_IDS)[number];

/** Kind-menu choice that opens the Help me choose wizard; never a `--preset`. */
export const HELP = "help" as const;

export type KindChoice = Preset | typeof HELP;

/** What {@link ApplicationCreate} settles before a dry run or a write. */
export type Intended = Readonly<{
  name: string;
  slug: string;
  preset: Preset;
  redirectUris: readonly [string, ...string[]];
  origins: readonly string[];
  applicationEnvFile: string | undefined;
}>;

type ApplicationBody =
  | ReturnType<typeof webApplication>
  | ReturnType<typeof spaApplication>
  | ReturnType<typeof nativeApplication>;

/** One preset's labels, suggestions, and publish/summary behavior. */
export type PresetProfile = Readonly<{
  id: Preset;
  label: string;
  hint: string;
  redirectSuggestions: readonly [string, ...string[]];
  clientType: "confidential" | "public";
  wantsOrigins: boolean;
  wroteLabel: string;
  build: (intended: Intended) => ApplicationBody;
}>;

/** Profiles for every `--preset` value. */
export const PRESET_PROFILES: Readonly<Record<Preset, PresetProfile>> = {
  web: {
    id: "web",
    label: "Website with a backend",
    hint: "Your server handles sign-in and can keep a secret, e.g. Next.js, Rails, Django.",
    redirectSuggestions: [
      "http://localhost:3000/auth/callback",
      "http://localhost:3000/api/auth/callback/zitadel",
    ],
    clientType: "confidential",
    wantsOrigins: false,
    wroteLabel: "Wrote issuer, client id, secret, and callback",
    build: (intended) => {
      return webApplication({
        slug: intended.slug,
        name: intended.name,
        redirectUris: [...intended.redirectUris] as [string, ...string[]],
      });
    },
  },
  spa: {
    id: "spa",
    label: "Browser-only app",
    hint: "Sign-in runs in browser code only, e.g. a React, Vue or Angular SPA.",
    redirectSuggestions: ["http://localhost:5173/callback"],
    clientType: "public",
    wantsOrigins: true,
    wroteLabel: "Wrote issuer, client id, callback, and origins",
    build: (intended) => {
      return spaApplication({
        slug: intended.slug,
        name: intended.name,
        redirectUris: [...intended.redirectUris] as [string, ...string[]],
        allowedOrigins: [...intended.origins] as [string, ...string[]],
      });
    },
  },
  native: {
    id: "native",
    label: "Mobile or desktop app",
    hint: "An installed iOS, Android or desktop app that signs in via the system browser.",
    redirectSuggestions: ["com.acme.tunes:/callback", "http://127.0.0.1/callback"],
    clientType: "public",
    wantsOrigins: false,
    wroteLabel: "Wrote issuer, client id, and callback",
    build: (intended) => {
      return nativeApplication({
        slug: intended.slug,
        name: intended.name,
        redirectUris: [...intended.redirectUris] as [string, ...string[]],
      });
    },
  },
};

/**
 * A lightweight sniff of `package.json` for a preset highlight. Never skips
 * the kind question; never selects Help me choose.
 *
 * @param cwd - The project directory.
 * @returns The suggested preset, or `web` when nothing matches.
 */
export async function sniffPreset(cwd: string): Promise<Preset> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const names = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const scripts = Object.values(pkg.scripts ?? {}).join(" ");
    if (
      names.has("next") ||
      names.has("nuxt") ||
      names.has("@remix-run/react") ||
      names.has("@remix-run/node") ||
      /\brails\b/.test(scripts)
    ) {
      return "web";
    }
    if (
      names.has("electron") ||
      names.has("@tauri-apps/api") ||
      names.has("react-native") ||
      names.has("expo")
    ) {
      return "native";
    }
    if (names.has("vite") || names.has("react") || names.has("vue") || names.has("@angular/core")) {
      return "spa";
    }
  } catch {
    // No package.json or unreadable — keep the default highlight.
  }
  return "web";
}

/** Dependencies for asking which preset to use. */
export type AskPresetDeps = Readonly<{
  ask: Questions;
  say: (text: string) => void;
  cwd: string;
  retry: SuggestedCommand;
}>;

/**
 * Asks which client kind to register, including Help me choose.
 *
 * @param deps - Asker, cwd for sniff, and the retry suggestion.
 * @returns The resolved preset (never `help`).
 */
export async function askPreset(deps: AskPresetDeps): Promise<Preset> {
  const sniffed = await sniffPreset(deps.cwd);
  const choice = await deps.ask.select({
    name: "preset",
    message: "What are you connecting first?",
    flag: "--preset",
    retry: deps.retry,
    initialValue: sniffed,
    options: [
      ...PRESET_IDS.map((value) => {
        const profile = PRESET_PROFILES[value];
        return {
          value: value as KindChoice,
          label: profile.label,
          hint: profile.hint,
        };
      }),
      {
        value: HELP,
        label: "Help me choose",
        hint: "Answer two quick questions",
      },
    ],
  });
  if (choice !== HELP) {
    return choice;
  }
  const preset = await helpMeChoose(deps);
  deps.say(`Using preset: ${PRESET_PROFILES[preset].label} (--preset ${preset})`);
  return preset;
}

/**
 * Taxonomy B: browser vs installed, then whether a server keeps a secret.
 *
 * @param deps - Asker and say.
 * @returns The preset the answers map to.
 */
export async function helpMeChoose(deps: Pick<AskPresetDeps, "ask" | "say">): Promise<Preset> {
  const where = await deps.ask.select({
    name: "sign-in surface",
    message: "Does sign-in run in a browser, or as an installed app?",
    options: [
      {
        value: "browser" as const,
        label: "Browser",
        hint: "Users open it at a web address",
      },
      {
        value: "installed" as const,
        label: "Installed app",
        hint: "Users download and install it",
      },
    ],
  });
  if (where === "installed") {
    return "native";
  }
  deps.say(
    "The sign-in callback is the URL users return to after signing in. Choose Yes if server code receives it, e.g. a Next.js route handler or Express route. Choose No if browser code receives it, even if you also have a separate API.",
  );
  const keepsSecret = await deps.ask.select({
    name: "client secret",
    message: "Does your server keep a client secret?",
    options: [
      {
        value: "yes" as const,
        label: "Yes",
        hint: "Server code receives the callback and stores a secret",
      },
      {
        value: "no" as const,
        label: "No",
        hint: "Browser code receives the callback",
      },
    ],
  });
  return keepsSecret === "yes" ? "web" : "spa";
}

/**
 * The publish body for the chosen preset.
 *
 * @param intended - The settled inputs.
 * @returns The request body.
 */
export function publishBody(intended: Intended): { application: ApplicationBody } {
  return { application: PRESET_PROFILES[intended.preset].build(intended) };
}

/**
 * How the client type is named on the success summary.
 *
 * @param clientType - confidential or public.
 * @returns The parenthetical label.
 */
export function clientKindLabel(clientType: "confidential" | "public"): string {
  return clientType === "confidential" ? "(confidential)" : "(public · PKCE · no secret)";
}
