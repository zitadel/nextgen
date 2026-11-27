import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn(async () => ({ messageId: "msg_1" })));
vi.mock("@vercel/queue", () => ({ send }));

import { WAKE_TOPIC, vercelWakeQueue, wakeQueue } from "./queue";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  send.mockClear();
});

const SCHEDULE = {
  delay_seconds: 6,
  idempotency_key: "proj_a:1794398406",
  retention_seconds: 3606,
};

describe("the wake-up queue", () => {
  it("publishes to the topic with the delay, the key and the retention", async () => {
    await vercelWakeQueue().publish({ project_id: "proj_a" }, SCHEDULE);

    expect(send).toHaveBeenCalledExactlyOnceWith(
      WAKE_TOPIC,
      { project_id: "proj_a" },
      { delaySeconds: 6, idempotencyKey: "proj_a:1794398406", retentionSeconds: 3606 },
    );
  });

  it("is Vercel Queues on Vercel, in production too", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    await wakeQueue().publish({ project_id: "proj_a" }, SCHEDULE);
    expect(send).toHaveBeenCalledOnce();
  });

  it("queues nothing anywhere else", async () => {
    vi.stubEnv("VERCEL", "");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await wakeQueue().publish({ project_id: "proj_a" }, SCHEDULE);

    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("webhook wake (mock, not queued): proj_a in 6s");
  });
});

// The topic, its consumer's file and the trigger's type live in three places;
// Vercel ignores a functions key that matches no file, and a consumer no
// trigger names is never called.
describe("repo-root vercel.json", () => {
  const service = resolve(import.meta.dirname, "../..");
  const config = JSON.parse(readFileSync(resolve(service, "../../vercel.json"), "utf8"));
  const functions: Record<string, { experimentalTriggers?: Record<string, unknown>[] }> =
    config.services["cloud-functions"].functions;

  it("subscribes the consumer's route to the topic the hook publishes to", () => {
    const consumers = Object.entries(functions).filter(([, fn]) => fn.experimentalTriggers);
    expect(consumers).toHaveLength(1);
    const [[file, fn]] = consumers as [[string, { experimentalTriggers: unknown[] }]];
    expect(existsSync(resolve(service, file))).toBe(true);
    expect(readFileSync(resolve(service, file), "utf8")).toContain("handleCallback(");
    expect(fn.experimentalTriggers).toEqual([
      { type: "queue/v2beta", topic: WAKE_TOPIC, retryAfterSeconds: 30, maxDeliveries: 20 },
    ]);
  });
});
