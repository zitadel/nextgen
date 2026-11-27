import { resolve as resolvePath } from "node:path";

import { Flags } from "@oclif/core";
import { webApplication } from "@zitadel/config/application-presets";
import { slugFromDisplayName } from "@zitadel/config/idp";
import { z } from "zod";

import { CommandGroups } from "@/cli/commands/groups";
import { ChangeCommand } from "@/cli/commands/bases";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { filled, reads, type Refused } from "@/cli/core/flags";
import { Promptable } from "@/cli/core/promptable";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { Telemetered } from "@/cli/telemetry/telemetered";
import { ApplicationService, ConflictError } from "@/lib/backend";
import { Project } from "@/lib/project";
import { escapeControlCharacters } from "@/lib/terminal-text";

/** The product event a create sends once the API confirms it. */
const APPLICATION_CREATED = "application_created";

/** Client kinds a person may pick; `help` arrives in Slice 2. */
const PRESETS = ["web", "spa", "native"] as const;

type Preset = (typeof PRESETS)[number];

/** What each preset is called in the kind menu. */
const PRESET_LABELS: Readonly<Record<Preset, string>> = {
  web: "Website with a backend",
  spa: "Browser-only app",
  native: "Mobile or desktop app",
};

/** What each preset means, shown beside the kind menu. */
const PRESET_HINTS: Readonly<Record<Preset, string>> = {
  web: "Your server handles sign-in and can keep a secret, e.g. Next.js, Rails, Django.",
  spa: "Sign-in runs in browser code only, e.g. a React, Vue or Angular SPA.",
  native: "An installed iOS, Android or desktop app that signs in via the system browser.",
};

/** The longest product name the API stores. */
const NAME_MAX = 256;

/** A product name, trimmed and bounded as the API bounds it. */
const NAME_SCHEMA = filled.pipe(
  z.string().refine((name) => {
    return [...name].length <= NAME_MAX;
  }, `it is longer than ${NAME_MAX} characters`),
);

/** Who `--name` says the product is. */
const NAME = {
  schema: NAME_SCHEMA,
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Pass a product name of 1 to {max} characters.",
  },
  values: {
    max: NAME_MAX,
  },
} as const satisfies Refused<string>;

/** How spa/native is refused until the server accepts public clients. */
const PUBLIC_CLIENTS_REFUSAL = {
  message:
    "The server does not support public clients yet (--preset {preset}). Use --preset web, or wait for public client support.",
  hint: "Pass --preset web for a confidential client with a server-held secret.",
} as const satisfies Refusal;

/** How a derived slug that is empty is refused. */
const EMPTY_SLUG_REFUSAL = {
  message:
    "Could not derive an application slug from that name. Choose a name with letters or digits.",
  hint: "Pass a product name that includes a letter or digit.",
} as const satisfies Refusal;

/** How `--origin` with web or native is refused. */
const ORIGIN_PRESET_REFUSAL = {
  message:
    "--origin only applies to browser-only apps (--preset spa). Remove it for --preset {preset}; other presets don't call Zitadel from the browser",
  hint: "Drop --origin, or pass --preset spa.",
} as const satisfies Refusal;

/** How a declared-app slug conflict is refused. */
const DECLARED_SLUG_REFUSAL = {
  message:
    "Slug {slug} belongs to a declared application. Edit .zitadel/applications/{slug}.json and deploy, or choose another name.",
  hint: "Pick another product name, or change the declared file and deploy.",
} as const satisfies Refusal;

/** How a missing ZITADEL_ISSUER is refused after create inputs are settled. */
const MISSING_ISSUER_REFUSAL = {
  message: "ZITADEL_ISSUER is not set for this environment",
  hint: "Set ZITADEL_ISSUER to the origin your app serves from (for example http://localhost:3000), or run setup first.",
} as const satisfies Refusal;

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
 * Whether a redirect URI is valid for the preset. Web and spa need https or
 * loopback http; native may use a custom scheme.
 *
 * @param value - The URI as typed.
 * @param preset - The client kind.
 * @returns Why it is refused, or undefined when it is fine.
 */
function redirectUriProblem(value: string, preset: Preset): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || !URL.canParse(trimmed)) {
    return trimmed === ""
      ? "Enter a sign-in callback URL"
      : "Enter a full URL, starting with the scheme, e.g. com.acme.tunes:/callback";
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol === "") {
    return "Enter a full URL, starting with the scheme, e.g. com.acme.tunes:/callback";
  }
  if (preset === "native") {
    return undefined;
  }
  if (parsed.protocol === "https:") {
    return undefined;
  }
  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
    return undefined;
  }
  return "Sign-in callback must be an https URL, or http on localhost / 127.0.0.1";
}

/**
 * Whether an allowed origin is scheme+host[+port] with no path.
 *
 * @param value - The origin as typed.
 * @returns Why it is refused, or undefined when it is fine.
 */
function originProblem(value: string): string | undefined {
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

/** One redirect URI as a flag value, for any preset (native schemes included). */
const REDIRECT_URI = {
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
const ORIGIN = {
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

/** The path `--application-env-file` names. */
const ENV_FILE = {
  schema: filled,
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Pass a path to write credentials to, for example .env.local.",
  },
} as const satisfies Refused<string>;

/** What {@link ApplicationCreate} settles before a dry run or a write. */
type Intended = Readonly<{
  name: string;
  slug: string;
  preset: Preset;
  redirectUris: readonly [string, ...string[]];
  origins: readonly string[];
  applicationEnvFile: string | undefined;
}>;

/**
 * `zitadel application create` — register an application and its first OIDC
 * client on the project through `publishApplication`.
 *
 * `web` is live against today's confidential-client API. `spa` and `native`
 * accept the same flags and prompts, then refuse until the server supports
 * public clients. Credentials are always printed as a pasteable `.env` block;
 * `--application-env-file` (or an interactive yes) writes them to a file.
 */
export default class ApplicationCreate extends Telemetered(Promptable(ChangeCommand)) {
  static override description = "Register an application and its first OIDC client on the project.";
  static override group = CommandGroups.signIn;
  static override groupOrder = 20;

  static override examples = [
    '<%= config.bin %> application create --name "Acme Dashboard" --preset web --redirect-uri http://localhost:3000/auth/callback',
    "<%= config.bin %> application create --name Acme --preset web --redirect-uri http://localhost:3000/callback --application-env-file .env.local",
  ];

  static override flags = {
    name: Flags.custom<string>({ parse: reads(NAME) })({
      description: "Product name for the Application.",
    }),
    preset: Flags.custom<Preset>({})({
      options: [...PRESETS],
      description: "Client kind (website backend, browser-only, or installed app).",
    }),
    "redirect-uri": Flags.custom<string>({ parse: reads(REDIRECT_URI) })({
      description: "Sign-in callback URL (repeatable).",
      multiple: true,
    }),
    origin: Flags.custom<string>({ parse: reads(ORIGIN) })({
      description: "Allowed browser origin; spa only (repeatable).",
      multiple: true,
    }),
    "application-env-file": Flags.custom<string>({ parse: reads(ENV_FILE) })({
      description: "Write credentials to this file after create.",
    }),
  };

  /**
   * Says what would be registered, without writing.
   *
   * @param input - The flags of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ flags }: Admitted<typeof ApplicationCreate>): Promise<CommandResult> {
    const intended = await this.intended(flags);
    this.refusePublicClients(intended.preset);
    const body = this.body(intended);

    return dryRunResult({
      verb: "create",
      topic: "application",
      body,
      next: await this.realRun(),
    });
  }

  /**
   * Registers the application and prints credentials.
   *
   * @param input - The flags of the run.
   * @returns The run's envelope.
   */
  protected async apply({ flags }: Admitted<typeof ApplicationCreate>): Promise<CommandResult> {
    const intended = await this.intended(flags);
    this.refusePublicClients(intended.preset);
    const { projectId } = await this.connect();
    const issuerBase = this.environment.values.ZITADEL_ISSUER?.value?.replace(/\/$/, "");
    if (issuerBase === undefined || issuerBase === "") {
      throw refusalError(MISSING_ISSUER_REFUSAL, {});
    }
    const issuer = `${issuerBase}/__nextgen/oauth/${projectId}`;
    const body = this.body(intended);
    const applicationService = await this.service(ApplicationService);
    const published = await applicationService
      .publish({ application: body.application })
      .catch((error: unknown) => {
        if (error instanceof ConflictError && error.serverCode === "app.declared") {
          throw refusalError(DECLARED_SLUG_REFUSAL, { slug: intended.slug });
        }
        throw error;
      });

    const client = published.definition.clients[0];
    const secret = published.client_secrets?.find((entry) => {
      return entry.client === client?.slug;
    });
    const clientId = client?.client_id ?? "";
    const env: Record<string, string> = {
      ZITADEL_ISSUER: issuer,
      ZITADEL_CLIENT_ID: clientId,
      ...(secret === undefined ? {} : { ZITADEL_CLIENT_SECRET: secret.secret }),
      ZITADEL_CALLBACK_URL: intended.redirectUris[0],
    };

    const wrotePath = await this.writeEnv(intended, env);

    this.trackEvent(APPLICATION_CREATED, {
      preset: intended.preset,
      application_id: published.id,
    });

    const title = `Created Application ${escapeControlCharacters(intended.name)} and its first Client`;
    const paste = Object.entries(env)
      .map(([key, value]) => {
        return `  ${key}=${value}`;
      })
      .join("\n");

    return {
      status: "ok",
      data: {
        title,
        application: {
          id: published.id,
          name: intended.name,
          slug: published.slug,
        },
        client: {
          id: clientId,
          slug: client?.slug ?? "web",
          preset: intended.preset,
          type: "confidential",
          ...(secret === undefined ? {} : { secret: secret.secret }),
        },
        issuer,
        redirect_uris: [...intended.redirectUris],
        allowed_origins: null,
        env,
        wrote_env_file: wrotePath,
      },
      summary: {
        title,
        sections: [],
        lines: [
          `Application  ${escapeControlCharacters(published.id)}`,
          `Client       ${escapeControlCharacters(clientId)}  (confidential)`,
          "",
          `Issuer              ${escapeControlCharacters(issuer)}`,
          `Client ID           ${escapeControlCharacters(clientId)}`,
          ...(secret === undefined
            ? []
            : [`Client secret       ${escapeControlCharacters(secret.secret)}  (shown only once)`]),
          `Sign-in callbacks   ${intended.redirectUris.map((uri) => escapeControlCharacters(uri)).join(", ")}`,
          "",
          "Add to your app environment:",
          paste,
          "",
          "Store the client secret on your server now. It will not be shown again.",
          ...(wrotePath === null
            ? []
            : [
                "",
                `Wrote issuer, client id, secret, and callback to ${escapeControlCharacters(wrotePath)}`,
              ]),
          "",
          "Test it yourself:",
          "  1. Start your app and initiate sign-in",
          "  2. Confirm you return to your app successfully signed in",
          "Creating the configuration does not mean sign-in works until those checks pass.",
        ],
      },
    };
  }

  /**
   * The publish body for a web create. Spa/native never reach here while gated.
   *
   * @param intended - The settled inputs.
   * @returns The request body.
   */
  private body(intended: Intended): {
    application: ReturnType<typeof webApplication>;
  } {
    return {
      application: webApplication({
        slug: intended.slug,
        name: intended.name,
        redirectUris: [...intended.redirectUris] as [string, ...string[]],
      }),
    };
  }

  /**
   * Refuses spa/native until public clients ship.
   *
   * @param preset - The chosen kind.
   */
  private refusePublicClients(preset: Preset): void {
    if (preset === "spa" || preset === "native") {
      throw refusalError(PUBLIC_CLIENTS_REFUSAL, { preset });
    }
  }

  /**
   * Writes credentials when the run asked for a file.
   *
   * @param intended - The settled inputs, including an optional path.
   * @param env - The variables to persist.
   * @returns The path written, or null when nothing was written.
   */
  private async writeEnv(intended: Intended, env: Record<string, string>): Promise<string | null> {
    const path =
      intended.applicationEnvFile ??
      (this.nonInteractive
        ? undefined
        : (await this.ask.yesNo({
              name: "write env file",
              message: "Write credentials to a .env file?",
              initialValue: false,
            }))
          ? await this.ask.text({
              name: "env file path",
              message: "Where should we write them?",
              flag: "--application-env-file",
              initialValue: ".env.local",
              parse: (raw) => {
                const trimmed = raw.trim();
                return trimmed === ""
                  ? { ok: false, problem: "enter a path such as .env.local" }
                  : { ok: true, value: trimmed };
              },
            })
          : undefined);
    if (path === undefined) {
      return null;
    }
    const absolute = resolvePath(this.cwd, path);
    try {
      const file = Project.envFile(absolute);
      for (const [key, value] of Object.entries(env)) {
        await file.append(key, value);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw refusalError(
        {
          message: `Could not write ${path}: ${reason}`,
          hint: "Fix the path or permissions and run again with --application-env-file.",
        },
        {},
      );
    }
    return path;
  }

  /**
   * Settles name, preset, redirects and origins the same way for a dry run
   * and a real run. Non-interactive missing required flags are listed once.
   *
   * @param flags - The flags the command was given.
   * @returns The settled inputs.
   */
  private async intended(flags: Admitted<typeof ApplicationCreate>["flags"]): Promise<Intended> {
    const originsGiven = flags.origin ?? [];
    const redirectsGiven = flags.redirectUri ?? [];

    if (this.nonInteractive) {
      const missing: string[] = [];
      if (flags.name === undefined) {
        missing.push("--name");
      }
      if (flags.preset === undefined) {
        missing.push("--preset");
      }
      if (redirectsGiven.length === 0) {
        missing.push("--redirect-uri (repeat for more)");
      }
      if (flags.preset === "spa" && originsGiven.length === 0) {
        missing.push("--origin (repeat for more; spa only)");
      }
      if (missing.length > 0) {
        throw refusalError(
          {
            message: `Missing required flag ${missing.join(", ")}`,
            hint: "Pass every required flag, or run without --non-interactive to be asked.",
          },
          {},
        );
      }
    }

    const name =
      flags.name ??
      (await this.ask.text({
        name: "product name",
        message: "What's your product called?",
        flag: "--name",
        placeholder: "Acme Dashboard",
        parse: (raw) => {
          const parsed = NAME_SCHEMA.safeParse(raw);
          if (!parsed.success) {
            return {
              ok: false,
              problem: parsed.error.issues[0]?.message ?? "Enter a product name",
            };
          }
          if (raw.trim() === "") {
            return { ok: false, problem: "Enter a product name" };
          }
          return { ok: true, value: parsed.data };
        },
      }));

    const slug = slugFromDisplayName(name);
    if (slug === "") {
      throw refusalError(EMPTY_SLUG_REFUSAL, {});
    }

    const preset =
      flags.preset ??
      (await this.ask.select({
        name: "preset",
        message: "What are you connecting first?",
        flag: "--preset",
        retry: this.suggest({
          id: "application:create",
          flags: { preset: "web" },
        }),
        initialValue: "web",
        options: PRESETS.map((value) => {
          return {
            value,
            label: PRESET_LABELS[value],
            hint: PRESET_HINTS[value],
          };
        }),
      }));

    if (originsGiven.length > 0 && preset !== "spa") {
      throw refusalError(ORIGIN_PRESET_REFUSAL, { preset });
    }

    const redirectUris =
      redirectsGiven.length > 0
        ? this.validatedRedirects(redirectsGiven, preset)
        : await this.askRedirects(preset);

    const origins =
      preset !== "spa"
        ? []
        : originsGiven.length > 0
          ? this.validatedOrigins(originsGiven)
          : await this.askOrigins();

    return {
      name,
      slug,
      preset,
      redirectUris,
      origins,
      applicationEnvFile: flags.applicationEnvFile,
    };
  }

  /**
   * Validates flag redirect URIs for the preset.
   *
   * @param values - The URIs from `--redirect-uri`.
   * @param preset - The client kind.
   * @returns The URIs as a non-empty tuple.
   */
  private validatedRedirects(
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
   * Asks for at least one redirect URI, then optional more.
   *
   * @param preset - The client kind, for validation.
   * @returns The URIs.
   */
  private async askRedirects(preset: Preset): Promise<readonly [string, ...string[]]> {
    const first = await this.ask.text({
      name: "redirect URI",
      message: "Sign-in callback URL",
      flag: "--redirect-uri",
      placeholder:
        preset === "spa"
          ? "http://localhost:5173/callback"
          : preset === "native"
            ? "com.acme.tunes:/callback"
            : "http://localhost:3000/auth/callback",
      parse: (raw) => {
        const problem = redirectUriProblem(raw, preset);
        return problem === undefined ? { ok: true, value: raw.trim() } : { ok: false, problem };
      },
    });
    const uris = [first];
    while (
      await this.ask.yesNo({
        name: "another redirect URI",
        message: "Add another redirect URI?",
        initialValue: false,
      })
    ) {
      const next = await this.ask.text({
        name: "redirect URI",
        message: "Sign-in callback URL",
        flag: "--redirect-uri",
        parse: (raw) => {
          const problem = redirectUriProblem(raw, preset);
          if (problem !== undefined) {
            return { ok: false, problem };
          }
          const trimmed = raw.trim();
          if (uris.includes(trimmed)) {
            return { ok: false, problem: "That redirect URI is already listed" };
          }
          return { ok: true, value: trimmed };
        },
      });
      uris.push(next);
    }
    return uris as [string, ...string[]];
  }

  /**
   * Validates flag origins.
   *
   * @param values - The origins from `--origin`.
   * @returns The origins.
   */
  private validatedOrigins(values: readonly string[]): readonly string[] {
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
   * Asks for at least one allowed origin, then optional more.
   *
   * @returns The origins.
   */
  private async askOrigins(): Promise<readonly string[]> {
    const first = await this.ask.text({
      name: "allowed origin",
      message: "Allowed origin",
      flag: "--origin",
      placeholder: "http://localhost:5173",
      parse: (raw) => {
        const problem = originProblem(raw);
        return problem === undefined
          ? { ok: true, value: new URL(raw.trim()).origin }
          : { ok: false, problem };
      },
    });
    const origins = [first];
    while (
      await this.ask.yesNo({
        name: "another origin",
        message: "Add another origin?",
        initialValue: false,
      })
    ) {
      const next = await this.ask.text({
        name: "allowed origin",
        message: "Allowed origin",
        flag: "--origin",
        parse: (raw) => {
          const problem = originProblem(raw);
          if (problem !== undefined) {
            return { ok: false, problem };
          }
          const origin = new URL(raw.trim()).origin;
          if (origins.includes(origin)) {
            return { ok: false, problem: "That origin is already listed" };
          }
          return { ok: true, value: origin };
        },
      });
      origins.push(next);
    }
    return origins;
  }
}
