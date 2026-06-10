import { setTimeout as sleep } from "node:timers/promises";

import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { ZitadelError } from "../lib/errors";
import {
  currentUser,
  ensureImage,
  inspectContainer,
  metadataFromStart,
  startContainer,
  stopAndRemoveContainer,
} from "../lib/local-server/docker";
import {
  DEFAULT_LOCAL_SERVER_IMAGE,
  DEFAULT_LOCAL_SERVER_PORT,
  checkLocalServerHealth,
  ensureContainerIdentity,
  ensureLocalState,
  localContainerName,
  localServerUrl,
  writeRuntimeMetadata,
} from "../lib/local-server/runtime";

const START_TIMEOUT_MS = 90_000;

export default class Start extends BaseCommand {
  static override description = "Start a local Zitadel server.";
  static override flags = {
    image: Flags.string({ description: "Container image to run." }),
    port: Flags.integer({ description: "Local HTTP port.", default: DEFAULT_LOCAL_SERVER_PORT }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Start);
    const port = flags.port ?? DEFAULT_LOCAL_SERVER_PORT;
    const serverUrl = localServerUrl(port);
    await this.toMeta(flags, { resolveServer: false, source: serverUrl });

    validatePort(port);
    const image = flags.image ?? this.meta.env.ZITADEL_LOCAL_IMAGE ?? DEFAULT_LOCAL_SERVER_IMAGE;
    const containerName = localContainerName(this.meta.cwd);
    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: "Local Zitadel server start plan.",
          runtime: {
            container_name: containerName,
            image,
            port,
          },
          urls: {
            api: serverUrl,
            console: `${serverUrl}/ui/console/`,
            login: `${serverUrl}/ui/login/`,
          },
          next_commands: ["zitadel start"],
        },
      });
    }

    const paths = await ensureLocalState(this.meta.cwd);

    const existing = await inspectContainer(containerName);
    if (existing.exists && existing.running && (await checkLocalServerHealth(serverUrl))) {
      const metadata = metadataFromStart({
        cwdDataDir: paths.dataDir,
        cliVersion: this.meta.cliVersion,
        containerName,
        containerId: existing.id ?? containerName,
        image,
        port,
        serverUrl,
      });
      await writeRuntimeMetadata(this.meta.cwd, metadata);
      return this.emit({ status: "ok", data: readyData(metadata, true) });
    }

    if (existing.exists) {
      await stopAndRemoveContainer(containerName);
    }

    await ensureImage(image);
    const containerId = await startContainer({
      containerName,
      image,
      port,
      dataDir: paths.dataDir,
      identity: await ensureContainerIdentity(this.meta.cwd, currentUser()),
    });
    await waitForHealth(serverUrl, containerName);

    const metadata = metadataFromStart({
      cwdDataDir: paths.dataDir,
      cliVersion: this.meta.cliVersion,
      containerName,
      containerId,
      image,
      port,
      serverUrl,
    });
    await writeRuntimeMetadata(this.meta.cwd, metadata);
    return this.emit({ status: "ok", data: readyData(metadata, false) });
  }
}

function readyData(metadata: ReturnType<typeof metadataFromStart>, alreadyRunning: boolean) {
  return {
    title: alreadyRunning
      ? "Local Zitadel server is already running."
      : "Local Zitadel server is ready.",
    runtime: {
      container_name: metadata.container_name,
      container_id: metadata.container_id,
      image: metadata.image,
      port: metadata.port,
      data_dir: metadata.data_dir,
    },
    urls: {
      api: metadata.server_url,
      console: `${metadata.server_url}/ui/console/`,
      login: `${metadata.server_url}/ui/login/`,
    },
    next_actions: ["Set up your app, then start its dev server."],
    next_commands: [
      "npx @zitadel/cli@alpha setup --framework next --server local",
      "npm install",
      "npm run dev",
    ],
  };
}

async function waitForHealth(serverUrl: string, containerName: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (await checkLocalServerHealth(serverUrl, 1000)) {
      return;
    }
    await sleep(1000);
  }
  throw new ZitadelError("E_NETWORK", "Local Zitadel server did not become healthy", {
    hint: "Inspect the container logs, then reset the local runtime if needed.",
    nextCommands: ["zitadel logs", "zitadel reset --force"],
    details: { container_name: containerName, server_url: serverUrl },
  });
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ZitadelError("E_VALIDATION", `Invalid port ${String(port)}`, {
      hint: "Use a TCP port between 1 and 65535.",
    });
  }
}
