import { startMockServer } from "../src/server.js";

const rawPort = process.env.PORT;
const port = rawPort !== undefined ? parseInt(rawPort, 10) : 4000;

if (!Number.isFinite(port) || port < 1 || port > 65535) {
  console.error(
    `[api-mock] invalid PORT="${rawPort}" — must be an integer between 1 and 65535`,
  );
  process.exit(1);
}

const server = startMockServer(port);

function shutdown(signal: string): void {
  console.log(`\n[api-mock] received ${signal}, shutting down…`);
  // closeAllConnections() terminates idle keep-alive connections immediately
  // so server.close() can fire its callback without hanging indefinitely.
  server.closeAllConnections();
  server.close(() => {
    console.log("[api-mock] server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
