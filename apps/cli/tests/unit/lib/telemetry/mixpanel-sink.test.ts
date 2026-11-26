import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, vi } from "vitest";

import { MixpanelSink } from "@/lib/telemetry/mixpanel-sink";
import { it as fixtures } from "@tests/fixtures";

/**
 * A proxy that only listens for the CONNECT a client sends to reach an HTTPS host
 * through it, and says what the clients asked for. `HTTPS_PROXY` names it for the test.
 */
const it = fixtures.extend<{ proxy: { connects: string[] } }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async proxy({}, use) {
    const connects: string[] = [];
    const server = createServer();
    server.on("connect", (request, socket) => {
      connects.push(request.url ?? "");
      socket.destroy();
    });
    await new Promise<void>((listening) => {
      server.listen(0, "127.0.0.1", listening);
    });
    vi.stubEnv("HTTPS_PROXY", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await use({ connects });
    vi.unstubAllEnvs();
    await new Promise<void>((closed) => {
      server.close(() => {
        closed();
      });
    });
  },
});

describe("MixpanelSink behind a proxy", () => {
  it("makes its client and sends through the proxy HTTPS_PROXY names", async ({ proxy }) => {
    const sink = MixpanelSink.connect({
      env: { ZITADEL_TELEMETRY_ENV: "production" },
      token: "a-token",
      distinctId: "an-install",
      debug: false,
    });
    sink?.track("cli_command_started", { command: "status" });
    await sink?.flush(3000);

    expect(sink).toBeDefined();
    expect(proxy.connects).toHaveLength(1);
  });
});
