import type { DockerEngine, ServerProcesses } from "@/lib/server";

/**
 * The Docker a runtime works through, answering as a machine with no Docker
 * and no containers does for everything a test does not replace. A test names
 * only what it scripts, and none depends on whether Docker is installed.
 *
 * @param scripted - The methods to answer differently.
 * @returns A Docker engine.
 */
export function aDockerEngine(scripted: Partial<DockerEngine> = {}): DockerEngine {
  return {
    available: async () => ({ status: 0, stdout: "", stderr: "" }),
    followLogs: async () => undefined,
    inspect: async () => ({ exists: false, running: false }),
    readLogs: async () => "",
    remove: async () => false,
    ...scripted,
  };
}

/**
 * The processes a runtime works through, answering as a machine that started
 * none does for everything a test does not replace. A test names only what it
 * scripts, and none depends on the processes of the machine it runs on.
 *
 * @param scripted - The methods to answer differently.
 * @returns The processes.
 */
export function someProcesses(scripted: Partial<ServerProcesses> = {}): ServerProcesses {
  return {
    followLogs: async () => undefined,
    isRecordRunning: async () => false,
    readLog: async () => "",
    stopRecord: async (record) => ({ pid: record.pid, status: "stale", target: "process" }),
    ...scripted,
  };
}
