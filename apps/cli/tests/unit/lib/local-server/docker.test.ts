import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { dockerRunArgs, metadataFromStart } from "../../../../src/lib/local-server/docker";
import { CONTAINER_DATA_DIR, LAUNCH_CONTRACT } from "../../../../src/lib/local-server/runtime";

describe("local server Docker helpers", () => {
  // The server derives its default data dir next to the entrypoint, which lives
  // in root-owned /usr/local/bin. Without this ENV the image cannot start as the
  // non-root USER it declares, and `zitadel start --runtime docker` dies before
  // serving. CI has no Docker, so this parity check is the gate.
  it("ships an image whose data dir default matches the mount the CLI provides", async () => {
    const dockerfile = await readFile(
      new URL("../../../../../../Dockerfile", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain(`ENV NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`);
    // The declared USER is what makes the default location unwritable.
    expect(dockerfile).toContain("USER 65532:65532");
  });

  it("builds the single-container run command without an explicit encryption key", () => {
    const args = dockerRunArgs({
      containerName: "zitadel-server-test",
      image: "ghcr.io/zitadel/nextgen:test",
      port: 8090,
      dataDir: "/tmp/app/.zitadel/local/nextgen-data",
      identity: {
        uid: 501,
        gid: 20,
        passwdFile: "/tmp/app/.zitadel/local/container-passwd",
        groupFile: "/tmp/app/.zitadel/local/container-group",
      },
    });

    expect(args).toEqual([
      "run",
      "--detach",
      "--name",
      "zitadel-server-test",
      "--publish",
      "127.0.0.1:8090:8080",
      "--volume",
      `/tmp/app/.zitadel/local/nextgen-data:${CONTAINER_DATA_DIR}`,
      "--env",
      "NEXTGEN_SERVER_ADDRESS=:8080",
      "--env",
      `NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`,
      "--env",
      "NEXTGEN_SERVER_PUBLIC_BASE=http://localhost:8090",
      "--env",
      "NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true",
      "--volume",
      "/tmp/app/.zitadel/local/container-passwd:/etc/passwd:ro",
      "--volume",
      "/tmp/app/.zitadel/local/container-group:/etc/group:ro",
      "--user",
      "501:20",
      "ghcr.io/zitadel/nextgen:test",
    ]);
    expect(args.join(" ")).not.toContain("NEXTGEN_SERVER_ENCRYPTION_KEY");
  });

  // The record must say which launch contract the container got, or a later
  // `start` cannot tell it from a container created by an older CLI.
  it("records the current launch contract for a started container", () => {
    const metadata = metadataFromStart({
      cwdDataDir: "/tmp/app/.zitadel/local/nextgen-data",
      cliVersion: "0.0.0-test",
      containerName: "zitadel-server-test",
      containerId: "container-test-id",
      image: "ghcr.io/zitadel/nextgen:test",
      port: 8090,
      serverUrl: "http://localhost:8090",
    });
    expect(metadata.launch_contract).toBe(LAUNCH_CONTRACT);
  });
});
