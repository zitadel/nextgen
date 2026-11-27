import { resolve as resolvePath } from "node:path";

import { Flags } from "@oclif/core";
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

import {
  askPreset,
  clientKindLabel,
  type Intended,
  PRESET_IDS,
  type Preset,
  PRESET_PROFILES,
  publishBody,
} from "./create-preset";
import {
  askOrigins,
  askRedirects,
  ORIGIN,
  REDIRECT_URI,
  validatedOrigins,
  validatedRedirects,
} from "./create-uri";

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

/** The path `--application-env-file` names. */
const ENV_FILE = {
  schema: filled,
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Pass a path to write credentials to, for example .env.local.",
  },
} as const satisfies Refused<string>;

/**
 * `zitadel application create` — register an application and its first OIDC
 * client on the project through `publishApplication`.
 *
 * `--preset web` registers a confidential client with a one-shot secret.
 * `--preset spa` and `--preset native` register public clients (PKCE, no
 * secret); spa also requires `--origin`. Credentials are always printed as a
 * pasteable `.env` block; `--application-env-file` (or an interactive yes)
 * writes them to a file.
 */
export default class ApplicationCreate extends Telemetered(Promptable(ChangeCommand)) {
  static override description = "Register an application and its first OIDC client on the project.";
  static override group = CommandGroups.signIn;
  static override groupOrder = 20;

  static override examples = [
    '<%= config.bin %> application create --name "Acme Dashboard" --preset web --redirect-uri http://localhost:3000/auth/callback',
    "<%= config.bin %> application create --name Boards --preset spa --redirect-uri http://localhost:5173/callback --origin http://localhost:5173",
    "<%= config.bin %> application create --name Tunes --preset native --redirect-uri com.acme.tunes:/callback",
  ];

  static override flags = {
    name: Flags.custom<string>({ parse: reads(NAME) })({
      description: "Product name for the Application.",
    }),
    preset: Flags.custom<Preset>({})({
      options: [...PRESET_IDS],
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
    return dryRunResult({
      verb: "create",
      topic: "application",
      body: publishBody(intended),
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
    const { projectId } = await this.connect();
    const issuerBase = this.environment.values.ZITADEL_ISSUER?.value?.replace(/\/$/, "");
    if (issuerBase === undefined || issuerBase === "") {
      throw refusalError(MISSING_ISSUER_REFUSAL, {});
    }
    const issuer = `${issuerBase}/__nextgen/oauth/${projectId}`;
    const body = publishBody(intended);
    const applicationService = await this.service(ApplicationService);
    const published = await applicationService
      .publish({ application: body.application })
      .catch((error: unknown) => {
        if (error instanceof ConflictError && error.serverCode === "app.declared") {
          throw refusalError(DECLARED_SLUG_REFUSAL, { slug: intended.slug });
        }
        throw error;
      });

    const profile = PRESET_PROFILES[intended.preset];
    const client = published.definition.clients[0];
    const secret = published.client_secrets?.find((entry) => {
      return entry.client === client?.slug;
    });
    const clientId = client?.client_id ?? "";
    const allowedOrigins = profile.wantsOrigins ? [...intended.origins] : null;
    const env: Record<string, string> = {
      ZITADEL_ISSUER: issuer,
      ZITADEL_CLIENT_ID: clientId,
      ...(secret === undefined ? {} : { ZITADEL_CLIENT_SECRET: secret.secret }),
      ZITADEL_CALLBACK_URL: intended.redirectUris[0],
      ...(allowedOrigins === null ? {} : { ZITADEL_ALLOWED_ORIGINS: allowedOrigins.join(" ") }),
    };

    const wrotePath = await this.writeEnv(intended, env);

    this.annotate({
      preset: intended.preset,
      wrote_env_file: intended.applicationEnvFile !== undefined,
    });

    const title = `Created Application ${escapeControlCharacters(intended.name)} and its first Client`;
    const paste = Object.entries(env)
      .map(([key, value]) => {
        return `  ${key}=${value}`;
      })
      .join("\n");

    const secretLines =
      secret === undefined
        ? profile.clientType === "public"
          ? ["Client secret       none needed. PKCE protects sign-in instead."]
          : []
        : [`Client secret       ${escapeControlCharacters(secret.secret)}  (shown only once)`];
    const originLines =
      allowedOrigins === null
        ? []
        : [
            `Allowed origins     ${allowedOrigins.map((origin) => escapeControlCharacters(origin)).join(", ")}`,
          ];
    const storeSecretLines =
      secret === undefined
        ? []
        : ["Store the client secret on your server now. It will not be shown again.", ""];
    const wroteLines =
      wrotePath === null
        ? []
        : [`${profile.wroteLabel} to ${escapeControlCharacters(wrotePath)}`, ""];

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
          slug: client?.slug ?? intended.preset,
          preset: intended.preset,
          type: profile.clientType,
          ...(secret === undefined ? {} : { secret: secret.secret }),
        },
        issuer,
        redirect_uris: [...intended.redirectUris],
        allowed_origins: allowedOrigins,
        env,
        wrote_env_file: wrotePath,
      },
      summary: {
        title,
        sections: [],
        lines: [
          `Application  ${escapeControlCharacters(published.id)}`,
          `Client       ${escapeControlCharacters(clientId)}  ${clientKindLabel(profile.clientType)}`,
          "",
          `Issuer              ${escapeControlCharacters(issuer)}`,
          `Client ID           ${escapeControlCharacters(clientId)}`,
          ...secretLines,
          `Sign-in callbacks   ${intended.redirectUris.map((uri) => escapeControlCharacters(uri)).join(", ")}`,
          ...originLines,
          "",
          "Add to your app environment:",
          paste,
          "",
          ...storeSecretLines,
          ...wroteLines,
          "Test it yourself:",
          "  1. Start your app and initiate sign-in",
          "  2. Confirm you return to your app successfully signed in",
          "Creating the configuration does not mean sign-in works until those checks pass.",
        ],
      },
    };
  }

  /**
   * Writes credentials when the run asked for a file.
   *
   * @param intended - The settled inputs, including an optional path.
   * @param env - The variables to persist.
   * @returns The path written, or null when nothing was written.
   */
  private async writeEnv(intended: Intended, env: Record<string, string>): Promise<string | null> {
    const fromFlag = intended.applicationEnvFile;
    if (fromFlag !== undefined) {
      return this.appendEnv(fromFlag, env);
    }
    if (this.nonInteractive) {
      return null;
    }
    const write = await this.ask.yesNo({
      name: "write env file",
      message: "Write credentials to a .env file?",
      initialValue: false,
    });
    if (!write) {
      return null;
    }
    const path = await this.ask.text({
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
    });
    return this.appendEnv(path, env);
  }

  /**
   * Appends credentials to an env file under the project cwd.
   *
   * @param path - Relative or absolute path the person named.
   * @param env - The variables to persist.
   * @returns The path written.
   */
  private async appendEnv(path: string, env: Record<string, string>): Promise<string> {
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
      (await askPreset({
        ask: this.ask,
        say: (text) => {
          this.ui.say(text);
        },
        cwd: this.cwd,
        retry: this.suggest({
          id: "application:create",
          flags: { preset: "web" },
        }),
      }));

    if (originsGiven.length > 0 && preset !== "spa") {
      throw refusalError(ORIGIN_PRESET_REFUSAL, { preset });
    }

    const redirectUris =
      redirectsGiven.length > 0
        ? validatedRedirects(redirectsGiven, preset)
        : await askRedirects(this.ask, preset);

    const origins =
      preset !== "spa"
        ? []
        : originsGiven.length > 0
          ? validatedOrigins(originsGiven)
          : await askOrigins(this.ask, redirectUris[0]);

    return {
      name,
      slug,
      preset,
      redirectUris,
      origins,
      applicationEnvFile: flags.applicationEnvFile,
    };
  }
}
