import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Flags } from "@oclif/core";
import {
  APP_PRESETS,
  type AppDocument,
  type AppPresetId,
  appPresetSummary,
  composeAppDocument,
} from "@zitadel/config/app";
import { APP_FILE_SCHEMA_REF, META_SCHEMA_DIR, metaSchemaFiles } from "@zitadel/config/meta-schemas";

import { APPS_DIR } from "../../lib/app";
import { ZitadelError } from "../../lib/errors";
import { stableStringify } from "../../lib/json";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { nextCommandsData } from "../../lib/oclif/envelope";
import { Promptable } from "../../lib/oclif/promptable";

/** A slug as the app schema takes it. */
const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** The `${{ NAME }}` a declared client names its secret with. */
const SECRET_REFERENCE = /^\$\{\{ *([A-Z_][A-Z0-9_]*) *\}\}$/;

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
    slug: nonBlankArg({
      required: true,
      description: "The app's slug: lowercase letters, digits, - and _.",
    }),
  };
  static override flags = {
    preset: Flags.string({
      required: true,
      options: [...APP_PRESETS],
      description: `The shape of the app. ${APP_PRESETS.map((id) => `${id}: ${appPresetSummary(id)}`).join("; ")}.`,
    }),
    name: Flags.string({ description: "The app's name, shown on the consent screen. The slug when left out." }),
    "redirect-uri": Flags.string({
      multiple: true,
      description: "Where the client may send the user back after sign-in. Repeat for several.",
    }),
    identifier: Flags.string({
      description: "The URI of the API the app serves, which tokens for it carry as aud.",
    }),
    scope: Flags.string({ multiple: true, description: "A scope the API defines. Repeat for several." }),
    registered: Flags.boolean({
      default: false,
      description: "Register the app through the API instead of declaring it in .zitadel/apps/.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(AppCreate);
    await this.toMeta(flags);
    const slug = args.slug;
    if (!SLUG.test(slug) || slug.length > 64) {
      throw new ZitadelError("E_VALIDATION", `${slug} is not an app slug.`, {
        hint: "Use lowercase letters, digits, - and _, starting with a letter or digit.",
      });
    }
    const preset = flags.preset as AppPresetId;
    const path = `${APPS_DIR}/${slug}.json`;
    const cwd = this.meta.cwd;
    // Checked before anything is asked: a file that exists is not ours to
    // overwrite, and the release that declares it owns the app.
    if (!flags.registered && existsSync(join(cwd, path))) {
      throw new ZitadelError("E_CONFLICT", `${path} already exists.`, {
        hint: "Edit the file, or pick another slug.",
      });
    }

    let input = {
      slug,
      ...(flags.name === undefined ? {} : { name: flags.name }),
      ...(flags["redirect-uri"] === undefined ? {} : { redirectUris: flags["redirect-uri"] }),
      ...(flags.identifier === undefined ? {} : { identifier: flags.identifier }),
      ...(flags.scope === undefined ? {} : { scopes: flags.scope }),
    };
    for (const need of composeAppDocument(preset, input).missing) {
      if (need === "redirect_uris") {
        const uri = await this.input({
          kind: "text",
          name: "redirect URI",
          message: "Where should users be sent back to after they sign in? For example https://shop.example.com/callback.",
          flag: "--redirect-uri",
          parse: parseAbsoluteURI,
          retry: this.suggest(`apps create ${slug} --preset ${preset} --redirect-uri <uri>`),
        });
        input = { ...input, redirectUris: [uri] };
      } else {
        const identifier = await this.input({
          kind: "text",
          name: "API identifier",
          message: "What URI identifies the API? Tokens for it carry it as their audience, for example https://api.shop.example.com.",
          flag: "--identifier",
          parse: parseAbsoluteURI,
          retry: this.suggest(`apps create ${slug} --preset ${preset} --identifier <uri>`),
        });
        input = { ...input, identifier };
      }
    }
    const { document } = composeAppDocument(preset, input);

    if (flags.registered) {
      return this.register(document);
    }
    return this.declare(cwd, path, document);
  }

  /** Writes the app as a file of the release, with its meta-schema beside it. */
  private async declare(cwd: string, path: string, document: AppDocument): Promise<JsonEnvelope> {
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
    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, path, app: document, variables, ...nextCommandsData(next) },
        pretty: `Would write ${path}`,
      });
    }

    const target = join(cwd, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${stableStringify({ $schema: APP_FILE_SCHEMA_REF, ...document })}\n`, {
      flag: "wx",
    });
    // A project set up before apps existed has no app meta-schema yet, so an
    // editor could not validate the file. Missing ones are added; existing
    // ones are setup's and doctor's to refresh.
    const metaDir = join(cwd, META_SCHEMA_DIR);
    await mkdir(metaDir, { recursive: true });
    for (const file of metaSchemaFiles().filter((f) => f.name.startsWith("app"))) {
      const metaPath = join(metaDir, file.name);
      if (!existsSync(metaPath)) {
        await writeFile(metaPath, `${JSON.stringify(file.body, null, 2)}\n`);
      }
    }
    return this.emit({
      status: "ok",
      data: { path, app: document, variables, ...nextCommandsData(next) },
      pretty: [
        `Wrote ${path}.`,
        ...variables.map((name) => `Set ${name} before you deploy: the client authenticates with it.`),
        "The app is declared with your next deploy.",
      ].join("\n"),
    });
  }

  /** Registers the app through POST /apps and shows what comes next, once. */
  private async register(document: AppDocument): Promise<JsonEnvelope> {
    if (this.meta.dryRun) {
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

function parseAbsoluteURI(value: string): { ok: true; value: string } | { ok: false; problem: string } {
  const uri = value.trim();
  // The server checks the rest (https, loopback, canonical form) and says
  // which rule a URI breaks; this only keeps a typo from reaching it.
  return URL.canParse(uri) ? { ok: true, value: uri } : { ok: false, problem: `${value} is not an absolute URI.` };
}
