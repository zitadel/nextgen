// Preloaded with `node --import` into the remote lane's child processes (the
// CLI, the generated app's dev server), so the https edge's name resolves to
// loopback there. See remoteHostEnv in https-edge.mjs.
import { installRemoteHostResolution } from "./https-edge.mjs";

installRemoteHostResolution();
