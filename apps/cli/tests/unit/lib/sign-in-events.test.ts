import { describe, expect, it } from "vitest";

import { parseSignInEvent, watchSignInEvents } from "../../../src/lib/sign-in-events";

const json = (fields: Record<string, unknown>, nested?: string) =>
  JSON.stringify({
    time: "2026-10-19T12:00:00Z",
    level: "INFO",
    msg: "sso attempt",
    ...(nested === undefined ? fields : { [nested]: fields }),
  });

const OK = { slug: "google", flow_id: "att_1", phase: "ceremony_started", status: "ok" };

describe("parseSignInEvent", () => {
  it("reads a JSON event", () => {
    expect(parseSignInEvent(json(OK))).toEqual({
      slug: "google",
      flowId: "att_1",
      phase: "ceremony_started",
      status: "ok",
    });
  });

  it.each(["request", "service"])("reads a JSON event nested under the %s stream", (stream) => {
    expect(parseSignInEvent(json(OK, stream))).toMatchObject({
      slug: "google",
      phase: "ceremony_started",
    });
  });

  it("reads a failure's reason and side and a resolution's result", () => {
    expect(
      parseSignInEvent(
        json({
          ...OK,
          phase: "resolved",
          status: "failed",
          reason: "creation_disabled",
          side: "journey",
        }),
      ),
    ).toMatchObject({ reason: "creation_disabled", side: "journey" });
    expect(parseSignInEvent(json({ ...OK, phase: "resolved", result: "linked" }))).toMatchObject({
      result: "linked",
    });
  });

  it("reads an event from a line a container prefixed with its own timestamp", () => {
    expect(parseSignInEvent(`2026-10-19T12:00:00Z ${json(OK)}`)).toMatchObject({ slug: "google" });
  });

  it("reads a text event, with or without a stream prefix on its keys", () => {
    const line =
      'time=2026-10-19T12:00:00Z level=WARN msg="sso attempt" stream=service service.slug=google service.flow_id=att_1 service.phase=exchange_finished service.status=failed service.reason=exchange_failed service.side=provider';

    expect(parseSignInEvent(line)).toEqual({
      slug: "google",
      flowId: "att_1",
      phase: "exchange_finished",
      status: "failed",
      reason: "exchange_failed",
      side: "provider",
    });
  });

  it("reads an event with no attempt as one with an empty flow id", () => {
    expect(parseSignInEvent(json({ ...OK, flow_id: "" }))).toMatchObject({ flowId: "" });
  });

  it.each([
    ["another message", JSON.stringify({ msg: "sso callback failed", ...OK })],
    ["a phase it does not know", json({ ...OK, phase: "mystery" })],
    ["a status it does not know", json({ ...OK, status: "maybe" })],
    ["no slug", json({ phase: "resolved", status: "ok" })],
    ["a line that is not an event", "listening on :8080"],
    ["broken JSON", '{"msg": "sso attempt"'],
  ])("reads nothing from %s", (_name, line) => {
    expect(parseSignInEvent(line)).toBeUndefined();
  });
});

describe("watchSignInEvents", () => {
  const instantly = async () => {};

  async function collect(
    reads: readonly string[],
    count: number,
  ): Promise<readonly { slug: string; phase: string }[]> {
    const stop = new AbortController();
    let index = 0;
    const events = await watchSignInEvents(
      async () => reads[Math.min(index++, reads.length - 1)] ?? "",
      instantly,
      0,
      stop.signal,
    );
    const seen: { slug: string; phase: string }[] = [];
    for await (const event of events) {
      seen.push(event);
      if (seen.length === count) {
        stop.abort();
      }
    }
    return seen;
  }

  it("reports only what is logged after it began", async () => {
    const before = json({ ...OK, flow_id: "old" });
    const after = json({ ...OK, phase: "callback_received" });

    const seen = await collect([before, `${before}\n${after}`], 1);

    expect(seen).toEqual([expect.objectContaining({ phase: "callback_received" })]);
  });

  it("reports each line once however often it is polled", async () => {
    const first = json({ ...OK, time: "1" });
    const second = json({ ...OK, phase: "resolved", result: "linked", time: "2" });

    const seen = await collect(["", first, first, `${first}\n${second}`, `${first}\n${second}`], 2);

    expect(seen.map((event) => event.phase)).toEqual(["ceremony_started", "resolved"]);
  });

  it("takes its baseline when called, before anything is iterated", async () => {
    const stop = new AbortController();
    let reads = 0;
    const late = json({ ...OK, phase: "callback_received" });

    const events = await watchSignInEvents(
      async () => (reads++ === 0 ? "" : late),
      instantly,
      0,
      stop.signal,
    );
    const [first] = await (async () => {
      const seen = [];
      for await (const event of events) {
        seen.push(event);
        stop.abort();
      }
      return seen;
    })();

    expect(first).toMatchObject({ phase: "callback_received" });
  });

  it("resolves only once the log it compares against has been read", async () => {
    const stop = new AbortController();
    let release: () => void = () => {};
    const slowRead = new Promise<string>((resolve) => {
      release = () => resolve("");
    });
    let resolved = false;

    const watching = watchSignInEvents(() => slowRead, instantly, 0, stop.signal).then(() => {
      resolved = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const beforeTheReadFinished = resolved;
    release();
    await watching;
    stop.abort();

    expect([beforeTheReadFinished, resolved]).toEqual([false, true]);
  });

  it("ends when the signal aborts", async () => {
    const stop = new AbortController();
    stop.abort();

    const events = await watchSignInEvents(async () => "", instantly, 0, stop.signal);

    expect(await events[Symbol.asyncIterator]().next()).toMatchObject({ done: true });
  });
});
