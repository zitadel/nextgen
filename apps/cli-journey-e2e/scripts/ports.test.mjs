/* oxlint-disable playwright/expect-expect */
import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";

import {
  JOURNEY_PORT_BLOCK_SIZE,
  JOURNEY_PORT_BLOCK_START,
  canListen,
  createJourneyPortAllocator,
} from "./ports.mjs";

test("journey block stays below the Linux and macOS ephemeral floors", () => {
  assert.ok(JOURNEY_PORT_BLOCK_START + JOURNEY_PORT_BLOCK_SIZE - 1 < 32768);
  assert.ok(JOURNEY_PORT_BLOCK_START >= 1024);
});

test("reserves ports inside the block", async () => {
  const reservePort = createJourneyPortAllocator({ canListen: async () => true });
  const port = await reservePort(new Set());
  assert.ok(port >= JOURNEY_PORT_BLOCK_START);
  assert.ok(port < JOURNEY_PORT_BLOCK_START + JOURNEY_PORT_BLOCK_SIZE);
});

test("skips ports already reserved by this run", async () => {
  const reservePort = createJourneyPortAllocator({
    blockStart: 100,
    blockSize: 3,
    canListen: async () => true,
    initialOffset: 0,
  });
  const used = new Set([100, 101]);
  assert.equal(await reservePort(used), 102);
});

test("skips ports an existing listener occupies and advances past them", async () => {
  const busy = new Set([100, 102]);
  const reservePort = createJourneyPortAllocator({
    blockStart: 100,
    blockSize: 4,
    canListen: async (port) => !busy.has(port),
    initialOffset: 0,
  });
  assert.equal(await reservePort(new Set()), 101);
  assert.equal(await reservePort(new Set()), 103);
});

test("wraps around the block end", async () => {
  const reservePort = createJourneyPortAllocator({
    blockStart: 100,
    blockSize: 3,
    canListen: async () => true,
    initialOffset: 2,
  });
  assert.equal(await reservePort(new Set([102])), 100);
});

test("throws once the whole block is exhausted", async () => {
  const reservePort = createJourneyPortAllocator({
    blockStart: 100,
    blockSize: 2,
    canListen: async () => false,
    initialOffset: 0,
  });
  await assert.rejects(() => reservePort(new Set()), /no free port in 100-101/);
});

test("canListen reports a bound port as unavailable", async () => {
  const server = net.createServer();
  const boundPort = await new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePort(server.address().port));
  });
  try {
    assert.equal(await canListen(boundPort), false);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  assert.equal(await canListen(boundPort), true);
});
