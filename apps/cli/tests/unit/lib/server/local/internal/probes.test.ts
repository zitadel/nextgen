import { tmpdir } from "node:os";

import { describe, expect } from "vitest";

import { defaultClaimsDir, TcpPorts } from "@/lib/server/local/internal/probes";
import { it } from "@tests/unit/lib/server/local/occupied-port";

describe("defaultClaimsDir", () => {
  it("is inside the temp directory, so a claim never lands in a project", () => {
    expect(defaultClaimsDir().startsWith(tmpdir())).toBe(true);
  });

  it("is the same on every call, so every start of one user finds the same claims", () => {
    expect(defaultClaimsDir()).toBe(defaultClaimsDir());
  });

  it("is named by uid rather than account name, which can be missing or unsafe", () => {
    const uid = process.getuid?.();

    expect(defaultClaimsDir().endsWith(uid === undefined ? "zitadel-local-ports" : `-${uid}`)).toBe(
      true,
    );
  });
});

describe("TcpPorts reservations", () => {
  const port = 8080;

  it("gives a port to one start at a time", async ({ dir }) => {
    await new TcpPorts(dir).reserve(port);

    await expect(new TcpPorts(dir).reserve(port)).resolves.toBeUndefined();
  });

  it("gives the port out again once it is released", async ({ dir }) => {
    const ports = new TcpPorts(dir);
    const release = await ports.reserve(port);
    await release?.();

    await expect(ports.reserve(port)).resolves.toBeTypeOf("function");
  });

  it("keeps different ports apart", async ({ dir }) => {
    const ports = new TcpPorts(dir);
    await ports.reserve(port);

    await expect(ports.reserve(port + 1)).resolves.toBeTypeOf("function");
  });
});

describe("TcpPorts", () => {
  describe("given what the machine says about a port", () => {
    const portsOf = (answers: boolean, canBind: boolean) =>
      new TcpPorts(undefined, {
        answers: async () => answers,
        canBind: async () => canBind,
      });

    it("is free when nothing answers and it can be bound", async () => {
      await expect(portsOf(false, true).isFree(8080)).resolves.toBe(true);
    });

    it("is taken when something answers on it", async () => {
      await expect(portsOf(true, true).isFree(8080)).resolves.toBe(false);
    });

    it("is taken when it cannot be bound", async () => {
      await expect(portsOf(false, false).isFree(8080)).resolves.toBe(false);
    });
  });

  it("reports a port held on all interfaces as taken", async ({ occupiedPort }) => {
    const port = await occupiedPort();

    await expect(new TcpPorts().isFree(port)).resolves.toBe(false);
  });

  it("reports a port held on the loopback address alone as taken", async ({ occupiedPort }) => {
    const port = await occupiedPort("127.0.0.1");

    await expect(new TcpPorts().isFree(port)).resolves.toBe(false);
  });
});
