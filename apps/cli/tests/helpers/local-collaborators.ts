import { BinaryLauncher, DockerLauncher } from "@/lib/server/local";
import type { DockerEngine, ServerProcesses } from "@/lib/server";

/**
 * The Docker a runtime works through, answering as the real one does for
 * everything a test does not replace. A test names only what it scripts.
 *
 * @param scripted - The methods to answer differently.
 * @returns A Docker engine.
 */
export function aDockerEngine(scripted: Partial<DockerEngine> = {}): DockerEngine {
  return {
    available: () => DockerLauncher.available(),
    followLogs: (...args) => DockerLauncher.followLogs(...args),
    inspect: (...args) => DockerLauncher.inspect(...args),
    readLogs: (...args) => DockerLauncher.readLogs(...args),
    remove: (...args) => DockerLauncher.remove(...args),
    ...scripted,
  };
}

/**
 * The processes a runtime works through, answering as the real ones do for
 * everything a test does not replace. A test names only what it scripts.
 *
 * @param scripted - The methods to answer differently.
 * @returns The processes.
 */
export function someProcesses(scripted: Partial<ServerProcesses> = {}): ServerProcesses {
  return {
    followLogs: (...args) => BinaryLauncher.followLogs(...args),
    isRecordRunning: (...args) => BinaryLauncher.isRecordRunning(...args),
    readLog: (...args) => BinaryLauncher.readLog(...args),
    stopRecord: (...args) => BinaryLauncher.stopRecord(...args),
    ...scripted,
  };
}
