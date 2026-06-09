import { describe, expect, it } from "vitest";

import { CONTAINER_DATA_DIR } from "../../../../src/lib/local-server/runtime";
import { dockerRunArgs } from "../../../../src/lib/local-server/docker";

describe("local server Docker helpers", () => {
  it("builds the single-container run command without an explicit encryption key", () => {
    const args = dockerRunArgs({
      containerName: "zitadel-server-test",
      image: "ghcr.io/zitadel/nextgen:test",
      port: 8090,
      dataDir: "/tmp/app/.zitadel/local/nextgen-data",
      uid: 501,
      gid: 20,
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
      "--user",
      "501:20",
      "ghcr.io/zitadel/nextgen:test",
    ]);
    expect(args.join(" ")).not.toContain("NEXTGEN_SERVER_ENCRYPTION_KEY");
  });
});
