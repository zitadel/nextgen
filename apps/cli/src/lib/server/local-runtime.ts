import {
  assertLocalStateWritable,
  checkLocalServerHealth,
  CONTAINER_DATA_DIR,
  DEFAULT_LOCAL_SERVER_PORT,
  DEFAULT_LOCAL_SERVER_URL,
  defaultLocalServerImageForCliVersion,
  ensureLocalState,
  findUpward,
  LOCAL_RUNTIME_DIR,
  LOCAL_RUNTIME_FILE,
  localContainerName,
  localRuntimePaths,
  localServerUrl,
  loopbackReach,
  PLATFORM_PROJECT_ID,
  peekRuntimeMetadata,
  readNearestRuntimeMetadata,
  readPlatformRuntime,
  readRuntimeMetadata,
  RUNTIME_BACKENDS,
  resolveRuntimeBackend,
  runtimeSummary,
  sameLocalServer,
  writeRuntimeMetadata,
} from "./local/runtime";

export type {
  BinaryRuntimeMetadata,
  DockerRuntimeMetadata,
  RuntimeBackend,
  RuntimeMetadata,
} from "./local/runtime";

/**
 * What a directory records about the local server started in it
 * (`.zitadel/local/runtime.json`): where the record lives, how to read it, and
 * what it says. A record is read-only data: the server's own lifecycle writes
 * it, and a test arranges one with {@link LocalRuntime.write}.
 */
export class LocalRuntime {
  /** The address a local server answers on when nothing names another. */
  static readonly DEFAULT_URL: string = DEFAULT_LOCAL_SERVER_URL;

  /** The port a local server asks for first. */
  static readonly DEFAULT_PORT: number = DEFAULT_LOCAL_SERVER_PORT;

  /** The directory, from a project's root, that holds everything a local server keeps. */
  static readonly DIR: string = LOCAL_RUNTIME_DIR;

  /** The record of the server started in a directory, from the project's root. */
  static readonly FILE: string = LOCAL_RUNTIME_FILE;

  /** Where a container keeps the data directory it is given. */
  static readonly CONTAINER_DATA_DIR: string = CONTAINER_DATA_DIR;

  /** The project a local server hosts its own console under. */
  static readonly PLATFORM_PROJECT_ID: string = PLATFORM_PROJECT_ID;

  /** The runtimes `--runtime` names. */
  static readonly BACKENDS: typeof RUNTIME_BACKENDS = RUNTIME_BACKENDS;

  /** The record in `cwd`, or `undefined` when none was written there. */
  static readonly read = readRuntimeMetadata;

  /** The record in `cwd` read without recovering a malformed one. */
  static readonly peek = peekRuntimeMetadata;

  /** The record in `cwd` or the nearest parent that has one, and where it was found. */
  static readonly readNearest = readNearestRuntimeMetadata;

  /** The directory, from `cwd` upward, that holds `file`. */
  static readonly findUpward = findUpward;

  /** Where everything a local server keeps for `cwd` lives. */
  static readonly paths = localRuntimePaths;

  /** The name of the container a server in `cwd` runs as. */
  static readonly containerName = localContainerName;

  /** The address a local server on `port` answers on. */
  static readonly urlOf = localServerUrl;

  /** The image that goes with a CLI release. */
  static readonly imageFor = defaultLocalServerImageForCliVersion;

  /** The runtime a run asks for, or the one this machine can run. */
  static readonly resolveBackend = resolveRuntimeBackend;

  /** Creates the directories a local server keeps its state in. */
  static readonly ensureState = ensureLocalState;

  /** Whether the state directories can be written, and why not. */
  static readonly assertWritable = assertLocalStateWritable;

  /** What a record reports about itself, for a command's output. */
  static readonly summary = runtimeSummary;

  /** Whether two addresses name the same local server. */
  static readonly same = sameLocalServer;

  /** How the server at an address reaches this machine's loopback, judged by the nearest record. */
  static readonly loopbackReach = loopbackReach;

  /** The platform document a server publishes, or `undefined` when it hosts no platform project. */
  static readonly readPlatform = readPlatformRuntime;

  /** Writes the record of a directory; the server's own lifecycle does this, and tests arrange one by it. */
  static readonly write = writeRuntimeMetadata;

  /** Whether the server at an address answers its readiness probe. */
  static readonly isHealthy = checkLocalServerHealth;
}
