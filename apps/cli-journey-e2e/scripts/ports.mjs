import net from "node:net";
import { randomInt } from "node:crypto";

/**
 * Why a fixed block instead of asking the kernel via listen(:0): the runner
 * reserves every port long before its owner binds it — an app port is bound
 * only after the suite leaves the concurrency queue, scaffolds, and
 * npm-installs, which takes minutes. A port from the kernel's ephemeral range
 * does not survive that gap when suites run in parallel: their npm/Verdaccio
 * loopback traffic draws outbound *source* ports from the same range, and one
 * of those connections held the reserved port exactly when its owner tried to
 * bind (2026-08-01, full-pr runs 30697929038 and 30699241416 — vite "Port
 * 43785 is already in use").
 *
 * Ports below the ephemeral floor (Linux 32768, macOS/Windows 49152) are never
 * handed out as outbound source ports, so the only remaining collider is
 * another explicit listener, which the listen probe catches at reservation
 * time.
 */
export const JOURNEY_PORT_BLOCK_START = 22000;
export const JOURNEY_PORT_BLOCK_SIZE = 2000;

/**
 * Returns an async `reservePort(usedPorts)` that scans the journey block from
 * a random offset, skips ports already reserved by this run, and probes each
 * candidate with a real bind so existing listeners are skipped too.
 */
export function createJourneyPortAllocator({
  blockStart = JOURNEY_PORT_BLOCK_START,
  blockSize = JOURNEY_PORT_BLOCK_SIZE,
  canListen: canListenFn = canListen,
  initialOffset = randomInt(blockSize),
} = {}) {
  let cursor = initialOffset;
  return async function reservePort(usedPorts) {
    for (let scanned = 0; scanned < blockSize; scanned += 1) {
      const candidate = blockStart + ((cursor + scanned) % blockSize);
      if (usedPorts.has(candidate)) {
        continue;
      }
      if (await canListenFn(candidate)) {
        cursor = (candidate - blockStart + 1) % blockSize;
        return candidate;
      }
    }
    throw new Error(
      `no free port in ${blockStart}-${blockStart + blockSize - 1}; free up listeners in the journey port block`,
    );
  };
}

export function canListen(port) {
  return new Promise((resolveCanListen) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolveCanListen(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolveCanListen(true));
    });
  });
}
