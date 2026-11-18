import type { Hook } from "@oclif/core";

import { Recorder } from "@/cli/telemetry/recorder";

/**
 * Starts the one recorder before any command runs, so it hears every
 * announcement of the run. It is installed once for the process.
 */
const hook: Hook<"init"> = async () => {
  Recorder.install();
};

export default hook;
