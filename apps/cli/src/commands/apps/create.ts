import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Args, Flags } from "@oclif/core";
import {
  APP_PRESETS,
  type AppDocument,
  appPresetSummary,
  composeAppDocument,
} from "@zitadel/config/app";
import type { Parsed } from "@zitadel/config/idp";
import {
  APP_FILE_SCHEMA_REF,
  META_SCHEMA_DIR,
  metaSchemaFiles,
} from "@zitadel/config/meta-schemas";
import { z } from "zod";

import { APPS_DIR } from "../../lib/app";
import { stableStringify } from "../../lib/json";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { reads, type Refused, taken } from "../../lib/oclif/flags";
import { Promptable } from "../../lib/oclif/promptable";
import { interpolate, type Refusal, refusalError } from "../../lib/oclif/refusal";

/** The `${{ NAME }}` a declared client names its secret with. */
const SECRET_REFERENCE = /^\$\{\{ *([A-Z_][A-Z0-9_]*) *\}\}$/;

/** The app's slug, as the app schema takes it. */
const SLUG: Refused<string> = {
  schema: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  refusal: {
    message: "{value} is not an app slug.",
    hint: "Use up to 64 lowercase letters, digits, - and _, starting with a letter or digit.",
  },
};

/**
 * A URI a client is sent back to or an API is known by. The server checks the
 * rest (https, loopback, canonical form) and says which rule a URI breaks;
 * this only keeps a typo from reaching it.
 */
const ABSOLUTE_URI = z
  .string()
  .trim()
  .refine((uri) => URL.canParse(uri), "it is not an absolute URI");

/** What a URI that is not absolute is refused for, at its flag or its prompt. */
const URI_REFUSAL: Refusal = {
  message: "{value} is not an absolute URI.",
  hint: "Pass {input} the whole URI, scheme included.",
};

/** Where the client may send the user back after sign-in. */
const REDIRECT_URI: Refused<string> = { schema: ABSOLUTE_URI, refusal: URI_REFUSAL };

/** The URI the API the app serves is known by. */
const IDENTIFIER: Refused<string> = { schema: ABSOLUTE_URI, refusal: URI_REFUSAL };

/** What an app file that already exists is refused for: the release that declares it owns the app. */
const APP_FILE_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "{path} already exists.",
  hint: "Edit the file, or pick another slug.",
};

/**
 * `zitadel apps create <slug> --preset <preset>`: one app, its clients and the
 * APIs it serves, from a preset, so nobody picks grant types or authentication
 * methods.
 *
 * The developer's own apps are code (ADR 082 §3), so by default the command
 * writes `.zitadel/apps/<slug>.json` and the next deploy declares it.
 * `--registered` writes the same document through `POST /apps` instead, for an
 * app a product creates outside its repository; the answer carries each
 * client's id and any generated secret, once.
 */
export default class AppCreate extends Promptable(EnvironmentCommand) {
  static override description = "Declare an app from a preset, or register one through the API.";
  static override group = CommandGroups.authentication;
  static override examples = [
    "<%= config.bin %> apps create shop --preset web --redirect-uri https://shop.example.com/callback",
    "<%= config.bin %> apps create orders --preset backend --identifier https://api.shop.example.com --scope orders.read",
    "<%= config.bin %> apps create assistant --preset mcp-server --identifier https://shop.example.com/mcp",
    "<%= config.bin %> apps create partner --preset web --redirect-uri https://partner.example/cb --registered",
  ];
  static override args = {
    slug: Args.custom<string>({ parse: taken(SLUG) })({
      required: true,
      description: "The app's slug: lowercase letters, digits, - and _.",
    }),
  };
  static override flags = {
    preset: Flags.option({
      options: APP_PRESETS,
      required: true,
      description: `The shape of the app. ${APP_PRESETS.map((id) => `${id}: ${appPresetSummary(id)}`).join("; ")}.`,
    })(),
    name: Flags.string({
      description: "The app's name, shown on the consent screen. The slug when left out.",
    }),
    "redirect-uri": Flags.custom<string>({ parse: reads(REDIRECT_URI) })({
      multiple: true,
      description: "Where the client may send the user back after sign-in. Repeat for several.",
    }),
    identifier: Flags.custom<string>({ parse: reads(IDENTIFIER) })({
      description: "The URI of the API the app serves, which tokens for it carry as aud.",
    }),
    scope: Flags.string({
      multiple: true,
      description: "A scope the API defines. Repeat for several.",
    }),
    registered: Flags.boolean({
      default: false,
      description: "Register the app through the API instead of declaring it in .zitadel/apps/.",
    }),
  };

  protected async execute({ args, flags }: Admitted<typeof AppCreate>): Promise<JsonEnvelope> {
    const path = `${APPS_DIR}/${args.slug}.json`;
    // Checked before anything is asked: a file that exists is not ours to
    // overwrite, and the release that declares it owns the app.
    if (!flags.registered && existsSync(join(this.cwd, path))) {
      throw refusalError(APP_FILE_REFUSAL, { path });
    }

    let input = {
      slug: args.slug,
      ...(flags.name === undefined ? {} : { name: flags.name }),
      ...(flags.redirectUri === undefined ? {} : { redirectUris: flags.redirectUri }),
      ...(flags.identifier === undefined ? {} : { identifier: flags.identifier }),
      ...(flags.scope === undefined ? {} : { scopes: flags.scope }),
    };
    for (const need of composeAppDocument(flags.preset, input).missing) {
      if (need === "redirect_uris") {
        const uri = await this.input({
          kind: "text",
          name: "redirect URI",
          message:
            "Where should users be sent back to after they sign in? For example https://shop.example.com/callback.",
          flag: "--redirect-uri",
          parse: readURI,
          retry: this.suggest(
            `apps create ${args.slug} --preset ${flags.preset} --redirect-uri <uri>`,
          ),
        });
        input = { ...input, redirectUris: [uri] };
      } else {
        const identifier = await this.input({
          kind: "text",
          name: "API identifier",
          message:
            "What URI identifies the API? Tokens for it carry it as their audience, for example https://api.shop.example.com.",
          flag: "--identifier",
          parse: readURI,
          retry: this.suggest(
            `apps create ${args.slug} --preset ${flags.preset} --identifier <uri>`,
          ),
        });
        input = { ...input, identifier };
      }
    }
    const { document } = composeAppDocument(flags.preset, input);

    if (flags.registered) {
      // A registered app holds no variable reference: the server generates
      // each new confidential client's first secret and shows it once.
      return this.register({
        ...document,
        clients: document.clients?.map(({ secret: _reference, ...client }) => client),
      });
    }
    return this.declare(path, document);
  }

  /** Writes the app as a file of the release, with its meta-schema beside it. */
  private async declare(path: string, document: AppDocument): Promise<JsonEnvelope> {
    // A registered app holds no secret reference, and a declared one needs
    // its secret as a project variable: the references name what to set.
    const variables = (document.clients ?? []).flatMap((client) => {
      const match = typeof client.secret === "string" ? SECRET_REFERENCE.exec(client.secret) : null;
      return match?.[1] === undefined ? [] : [match[1]];
    });
    const next = [
      ...variables.map((name) => this.suggest(`variable set ${name} --secret`)),
      this.suggest("deploy"),
    ];
    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, path, app: document, variables },
        next: { commands: next },
        pretty: `Would write ${path}`,
      });
    }

    const target = join(this.cwd, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${stableStringify({ $schema: APP_FILE_SCHEMA_REF, ...document })}\n`, {
      flag: "wx",
    });
    // A project set up before apps existed has no app meta-schema yet, so an
    // editor could not validate the file. Missing ones are added; existing
    // ones are setup's and doctor's to refresh.
    const metaDir = join(this.cwd, META_SCHEMA_DIR);
    await mkdir(metaDir, { recursive: true });
    for (const file of metaSchemaFiles().filter((f) => f.name.startsWith("app"))) {
      const metaPath = join(metaDir, file.name);
      if (!existsSync(metaPath)) {
        await writeFile(metaPath, `${JSON.stringify(file.body, null, 2)}\n`);
      }
    }
    return this.emit({
      status: "ok",
      data: { path, app: document, variables },
      next: { commands: next },
      pretty: [
        `Wrote ${path}.`,
        ...variables.map(
          (name) => `Set ${name} before you deploy: the client authenticates with it.`,
        ),
        "The app is declared with your next deploy.",
      ].join("\n"),
    });
  }

  /** Registers the app through POST /apps and shows what comes next, once. */
  private async register(document: AppDocument): Promise<JsonEnvelope> {
    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, app: document },
        pretty: `Would register ${document.slug}`,
      });
    }
    const { client, projectId } = await this.connect();
    const created = await client.createApp({ app: document as never }, { project_id: projectId });
    return this.emit({
      status: "ok",
      data: {
        id: created.id,
        slug: created.slug,
        source: created.source,
        clients: created.clients,
        // Shown once: the server keeps only a hash.
        client_secrets: created.client_secrets ?? [],
      },
      pretty: [
        `Registered ${created.slug} (${created.id}).`,
        ...created.clients.map((c) => `Client ${c.slug}: ${c.client_id}`),
        ...(created.client_secrets ?? []).map(
          (s) => `Secret for ${s.client}, shown once: ${s.secret}`,
        ),
      ].join("\n"),
    });
  }
}

/** A URI typed at a prompt, held to the rule its flag applies. */
function readURI(answer: string): Parsed<string> {
  const parsed = ABSOLUTE_URI.safeParse(answer);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, problem: interpolate(URI_REFUSAL.message, { value: answer.trim() }) };
}
