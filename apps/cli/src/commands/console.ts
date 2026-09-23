import { Flags } from "@oclif/core";
import consola from "consola";

import { openInBrowser } from "../lib/browser";
import { ZitadelError } from "../lib/errors";
import { readLocalAdmin } from "../lib/local-server/admin-credential";
import { consoleSignInUrl } from "../lib/local-server/sign-in";
import {
  DEFAULT_LOCAL_SERVER_URL,
  readRuntimeMetadata,
  resolveLocalServer,
} from "../lib/local-server/runtime";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { publicCliCommand } from "../lib/public-cli";

/**
 * `zitadel console` — open the local console signed in as the local
 * admin `zitadel start` created. Every run mints a fresh one-time link, so the
 * command is also how you get back in after the session ends.
 */
export default class Console extends BaseCommand {
  static override description =
    "Open the local console, signed in as the local admin created by `zitadel start`.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 7;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --no-open",
  ];

  static override flags = {
    "no-open": Flags.boolean({ description: "Print the sign-in link instead of opening a browser." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Console);
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const runtime = await readRuntimeMetadata(cwd);
    await this.toMeta(flags, {
      resolveServer: false,
      source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
    });

    const admin = await readLocalAdmin(cwd);
    if (!admin) {
      throw new ZitadelError("E_VALIDATION", "No local admin in this directory", {
        hint: "Run `zitadel start` first; it creates the local admin the console signs in as.",
        nextCommands: [publicCliCommand("start", this.meta.cliVersion)],
      });
    }

    // A link is minted by running the real login flow, which burns a one-time
    // handoff token on the server — a mutation, so a dry run only reports who
    // it would sign in as.
    if (this.meta.dryRun) {
      consola.info(`Would mint a console sign-in link for ${admin.email}.`);
      return this.emit({
        status: "ok",
        data: {
          title: "Local console sign-in link.",
          signed_in_as: admin.email,
          dry_run: true,
        },
      });
    }

    const serverUrl = await resolveLocalServer(cwd);
    const signInUrl = await consoleSignInUrl(serverUrl, admin);

    consola.log(`Signed in to the local console as ${admin.email}:`);
    consola.log(signInUrl);
    const skipLaunch = flags["no-open"] || this.meta.nonInteractive;
    const opened = skipLaunch ? false : (await openInBrowser(signInUrl)).opened;
    if (!opened) {
      consola.info("Open the link above. It works once; run this command again for a new one.");
    }

    return this.emit({
      status: "ok",
      data: {
        title: "Local console sign-in link.",
        signed_in_as: admin.email,
        sign_in_url: signInUrl,
        browser_opened: opened,
        next_actions: [
          "The link signs you in once. Run `zitadel console` again for a fresh one.",
        ],
      },
    });
  }
}
