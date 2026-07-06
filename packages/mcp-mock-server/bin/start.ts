import { loadConfig } from "../src/config.js";
import { startMcpMockServer } from "../src/server.js";

let server: ReturnType<typeof startMcpMockServer>;

try {
  server = startMcpMockServer(loadConfig());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mcp-mock-server] ${message}`);
  process.exit(1);
}

function shutdown(signal: string): void {
  console.log(`\n[mcp-mock-server] received ${signal}, shutting down…`);
  server.closeAllConnections();
  server.close(() => {
    console.log("[mcp-mock-server] server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
