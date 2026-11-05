import type {
  BinaryRuntimeMetadata,
  DockerRuntimeMetadata,
} from "../../src/lib/local-server/runtime";

/**
 * A `.zitadel/local/runtime.json` record of a server started as a process. The
 * defaults are a plausible record; a test overrides only what it is about, so
 * it never has to build one by hand or cast a partial one into shape.
 */
export function aBinaryRecord(
  overrides: Partial<BinaryRuntimeMetadata> = {},
): BinaryRuntimeMetadata {
  const port = overrides.port ?? 8099;
  return {
    schema_version: 1,
    backend: "binary",
    pid: 4242,
    command: "/opt/zitadel/nextgen --migrate",
    log_path: "/work/.zitadel/local/server.log",
    server_package: "@zitadel/server",
    server_version: "1.0.0",
    port,
    server_url: `http://localhost:${port}`,
    data_dir: "/work/.zitadel/local/nextgen-data",
    created_at: "2026-01-01T00:00:00.000Z",
    cli_version: "1.0.0",
    ...overrides,
  };
}

/** The same for a server started as a container. */
export function aDockerRecord(
  overrides: Partial<DockerRuntimeMetadata> = {},
): DockerRuntimeMetadata {
  const port = overrides.port ?? 8099;
  return {
    schema_version: 1,
    backend: "docker",
    container_name: "zitadel-server-abc",
    container_id: "abc",
    image: "ghcr.io/zitadel/nextgen:latest",
    port,
    server_url: `http://localhost:${port}`,
    data_dir: "/work/.zitadel/local/nextgen-data",
    created_at: "2026-01-01T00:00:00.000Z",
    cli_version: "1.0.0",
    ...overrides,
  };
}
