import type { LocalServerErrorKind } from "@/lib/server";
import { PM } from "@/lib/pm";
import { type Suggested, suggestedCommandOf } from "./index";
import { CliPackage } from "@/lib/upgrade";

/** What a reader is told to do about one kind of local server failure. */
export interface LocalServerAdvice {
  readonly hint: string;
  readonly next?: readonly Suggested[];
}

/**
 * What to tell the reader about each failure of the local server. The server
 * package names the failure; this is the advice that goes with it.
 *
 * The reset that fixes a malformed or missing admin deletes local data, so
 * where it is only a possible cure it stays in a hint a person reads and never
 * becomes a next command an agent runs.
 */
export const LOCAL_SERVER_ADVICE = {
  "not-running": {
    hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
    next: [{ id: "start" }],
  },
  "not-responding": {
    hint: "No healthy local server responded at {server_url}. Run `zitadel start` to bring it back.",
    next: [{ id: "start" }],
  },
  "not-started": {
    hint: "Run `zitadel start` first.",
    next: [{ id: "start" }],
  },
  "record-unreadable": {
    hint: "Check that {path} and its directory are readable by you.",
  },
  "record-malformed": {
    hint: "Run `zitadel reset --force`, then `zitadel start`, each in {directory}.",
    next: [{ id: "reset", flags: { force: true } }, { id: "start" }],
  },
  "admin-unreadable": {
    hint: "Check that {path} is readable by you; `zitadel start` writes it owner-only.",
  },
  "admin-malformed": {
    hint: "Delete {path} and run `zitadel reset --force`, then `zitadel start`. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.",
    next: [{ id: "reset", flags: { force: true } }, { id: "start" }],
  },
  "admin-not-found": {
    hint: "Check `zitadel logs` first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — `zitadel reset --force` deletes the local data so `zitadel start` can import it again.",
    next: [{ id: "logs" }],
  },
  "env-unreadable": {
    hint: "The file {path} exists but could not be read; fix its permissions or remove it.",
  },
  "package-missing": {
    hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
    next: [suggestedCommandOf(PM.named("npm").add([`${CliPackage.NAME}@latest`]))],
  },
  "cannot-launch": {
    hint: "Check that the server binary exists and can be run, or reinstall @zitadel/cli.",
    next: [suggestedCommandOf(PM.named("npm").add([`${CliPackage.NAME}@latest`]))],
  },
  "docker-failed": {
    hint: "Check that Docker is installed, running, and reachable from this shell.",
    next: [{ id: "doctor" }],
  },
  "start-in-progress": {
    hint: "Wait for it to finish, or delete {lock_file} if no start is running.",
  },
  "session-exchange-failed": {
    hint: "Check `zitadel logs` for why the local server refused the admin's session.",
  },
  "platform-missing": {
    hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
    next: [{ id: "stop" }, { id: "start" }],
  },
  "processes-did-not-stop": {
    hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
  },
  "docker-unavailable": {
    hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
    next: [{ id: "doctor" }],
  },
  "no-free-port": {
    hint: "Free a port, or pick one with `zitadel start --port <port>`.",
  },
  "port-in-use": {
    hint: "Stop whatever holds the port, or pick another with `zitadel start --port <port>`.",
  },
  "server-did-not-start": {
    hint: "Read `zitadel logs` for why the server did not become healthy, then run `zitadel start` again.",
    next: [{ id: "logs" }, { id: "start" }],
  },
  "permit-mismatch": {
    hint: "A reset acts on one folder only. Run it from the folder whose server you mean to reset.",
  },
  "server-did-not-stop": {
    hint: "Inspect the local runtime process and stop it manually, then rerun the command.",
  },
} satisfies Record<LocalServerErrorKind, LocalServerAdvice> as Readonly<
  Record<LocalServerErrorKind, LocalServerAdvice>
>;
