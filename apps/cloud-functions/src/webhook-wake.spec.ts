import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WakeQueue, WakeSchedule, WebhookWake } from "./ports";
import { deliverWake, receiveWake, wakeSchedule } from "./webhook-wake";

const SECRET = "0123456789abcdef-wake";
const CRON = "0123456789abcdef-cron";
/** 12:00:00.250 UTC: a quarter into a second. */
const NOW = Date.parse("2026-11-11T12:00:00.250Z");
const SECOND = Math.floor(NOW / 1000);

function recordingQueue(fail?: Error) {
  const published: { wake: WebhookWake; schedule: WakeSchedule }[] = [];
  const queue: WakeQueue = {
    async publish(wake, schedule) {
      if (fail) throw fail;
      published.push({ wake, schedule });
    },
  };
  return { queue, published };
}

function hook(body: unknown, authorization: string | null = `Bearer ${SECRET}`) {
  return new Request("https://cloud.example/cloud/hooks/webhook-wake", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization === null ? {} : { authorization }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("WEBHOOK_WAKE_SECRET", SECRET);
  vi.stubEnv("CRON_SECRET", CRON);
  vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "");
  vi.stubEnv("CLOUD_ZITADEL_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("when a wake-up is delivered", () => {
  it("goes out when the second it arrived in is over", () => {
    expect(wakeSchedule("proj_a", NOW)).toEqual({
      delay_seconds: 1,
      idempotency_key: `proj_a:${SECOND + 1}`,
      retention_seconds: 3601,
    });
  });

  it("shares a key within a second, so a burst is one message", () => {
    const keys = [0, 100, 700, 749].map(
      (later) => wakeSchedule("proj_a", NOW + later).idempotency_key,
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("takes a new key in the next second: an event stored after a message went out wakes again", () => {
    const first = wakeSchedule("proj_a", NOW);
    // The first message is delivered no sooner than its delay after `NOW`.
    const afterDelivery = NOW + first.delay_seconds * 1000;
    expect(wakeSchedule("proj_a", afterDelivery).idempotency_key).not.toBe(first.idempotency_key);
    expect(wakeSchedule("proj_a", SECOND * 1000 + 1000).idempotency_key).not.toBe(
      first.idempotency_key,
    );
  });

  it("never delivers before the second of its key has ended, wherever in it the wake-up arrives", () => {
    for (const offset of [0, 1, 250, 999]) {
      const now = SECOND * 1000 + offset;
      const { delay_seconds, idempotency_key } = wakeSchedule("proj_a", now);
      const keySecond = Number(idempotency_key.split(":")[1]);
      expect(now + delay_seconds * 1000).toBeGreaterThanOrEqual(keySecond * 1000);
    }
  });

  it("keeps projects apart", () => {
    expect(wakeSchedule("proj_a", NOW).idempotency_key).not.toBe(
      wakeSchedule("proj_b", NOW).idempotency_key,
    );
  });

  it("delays a retry until it is due, under the key of that second", () => {
    const due = NOW + 40_000;
    expect(wakeSchedule("proj_a", NOW, due)).toEqual({
      delay_seconds: 41,
      idempotency_key: `proj_a:${SECOND + 41}`,
      retention_seconds: 3641,
    });
  });

  it("treats a retry that is already due as due now", () => {
    expect(wakeSchedule("proj_a", NOW, NOW - 60_000)).toEqual(wakeSchedule("proj_a", NOW));
  });

  it("delays no longer than the server's longest wait", () => {
    expect(wakeSchedule("proj_a", NOW, NOW + 86_400_000).delay_seconds).toBeLessThanOrEqual(3601);
  });
});

describe("the server's wake hook", () => {
  it("queues a wake-up for the project and answers 202", async () => {
    const { queue, published } = recordingQueue();
    const answer = await receiveWake(hook({ project_id: "proj_a" }), queue, NOW);

    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ project_id: "proj_a", delay_seconds: 1 });
    expect(published).toEqual([
      { wake: { project_id: "proj_a" }, schedule: wakeSchedule("proj_a", NOW) },
    ]);
  });

  it("queues a retry for when the server says it is due", async () => {
    const { queue, published } = recordingQueue();
    const due = new Date(NOW + 5000).toISOString();
    const answer = await receiveWake(hook({ project_id: "proj_a", not_before: due }), queue, NOW);

    expect(answer.status).toBe(202);
    expect(published[0]?.schedule).toEqual(wakeSchedule("proj_a", NOW, NOW + 5000));
    expect(published[0]?.schedule.delay_seconds).toBe(6);
  });

  it("puts nothing but the project into the message", async () => {
    const { queue, published } = recordingQueue();
    await receiveWake(hook({ project_id: "proj_a", event: { id: "evt_1" } }), queue, NOW);
    expect(published[0]?.wake).toEqual({ project_id: "proj_a" });
  });

  it.each([
    ["no credentials", null],
    ["another secret", "Bearer 0123456789abcdef-other"],
    ["the secret, cut short", `Bearer ${SECRET.slice(0, -1)}`],
    ["another scheme", `Basic ${SECRET}`],
    ["the cron job's secret", `Bearer ${CRON}`],
  ])("refuses %s", async (_, authorization) => {
    const { queue, published } = recordingQueue();
    const answer = await receiveWake(hook({ project_id: "proj_a" }, authorization), queue, NOW);

    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({ error: { code: "cloud.wake_unauthorized" } });
    expect(published).toEqual([]);
  });

  it("is not live without its secret, whatever the caller sends", async () => {
    vi.stubEnv("WEBHOOK_WAKE_SECRET", "");
    const { queue, published } = recordingQueue();
    const answer = await receiveWake(hook({ project_id: "proj_a" }, "Bearer "), queue, NOW);

    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ error: { code: "cloud.not_live" } });
    expect(published).toEqual([]);
  });

  it.each([
    ["no project", {}],
    ["a project that is no id", { project_id: "proj a?x=1" }],
    ["a number", { project_id: 7 }],
    ["no JSON", "not json"],
    ["a time that is none", { project_id: "proj_a", not_before: "soon" }],
    ["a time that is a number", { project_id: "proj_a", not_before: 5 }],
  ])("answers 400 to %s", async (_, body) => {
    const { queue, published } = recordingQueue();
    const answer = await receiveWake(hook(body), queue, NOW);

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "cloud.invalid_wake" } });
    expect(published).toEqual([]);
  });

  it("answers 503 when the queue refuses, so the server knows the wake-up is lost", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { queue } = recordingQueue(new Error("401 from the queue"));
    const answer = await receiveWake(hook({ project_id: "proj_a" }), queue, NOW);

    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ error: { code: "cloud.queue_unavailable" } });
  });
});

describe("the queue's consumer", () => {
  function server(status = 200) {
    const fetch = vi.fn(
      async (_url: URL, _init: RequestInit) => new Response('{"webhooks":1}', { status }),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("calls the server's delivery path for the project, as the cron job authenticates", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "zitadel.example");
    vi.stubEnv("VERCEL_URL", "cloud-abc.vercel.app");
    const fetch = server();

    await deliverWake({ project_id: "proj_a" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://zitadel.example/cron/events-webhooks?project_id=proj_a");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${CRON}`);
    expect(headers.has("x-vercel-protection-bypass")).toBe(false);
  });

  it("reaches a preview's own deployment through its protection", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "zitadel.example");
    vi.stubEnv("VERCEL_URL", "cloud-abc.vercel.app");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass");
    const fetch = server();

    await deliverWake({ project_id: "proj_a" });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://cloud-abc.vercel.app/cron/events-webhooks?project_id=proj_a");
    expect(new Headers(init?.headers).get("x-vercel-protection-bypass")).toBe("bypass");
  });

  it("calls the server the local loops name", async () => {
    vi.stubEnv("CLOUD_ZITADEL_URL", "http://localhost:8094");
    const fetch = server();

    await deliverWake({ project_id: "proj_a" });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://localhost:8094/cron/events-webhooks?project_id=proj_a",
    );
  });

  it.each([500, 401, 404, 503])("throws on a %i, so the queue delivers again", async (status) => {
    vi.stubEnv("CLOUD_ZITADEL_URL", "http://localhost:8094");
    server(status);
    await expect(deliverWake({ project_id: "proj_a" })).rejects.toThrow(String(status));
  });

  it("throws when the server cannot be reached", async () => {
    vi.stubEnv("CLOUD_ZITADEL_URL", "http://localhost:8094");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(deliverWake({ project_id: "proj_a" })).rejects.toThrow("fetch failed");
  });

  it("throws without the trigger's secret, rather than call for a refusal", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("CLOUD_ZITADEL_URL", "http://localhost:8094");
    const fetch = server();
    await expect(deliverWake({ project_id: "proj_a" })).rejects.toThrow("CRON_SECRET");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[undefined], [{}], [{ project_id: "a b" }], ["proj_a"]])(
    "acknowledges a message that names no project: %j",
    async (message) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fetch = server();
      await expect(deliverWake(message)).resolves.toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
