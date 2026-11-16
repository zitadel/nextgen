import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "./fixtures.ts";
import { parseStage } from "./transcript.ts";

const parse = (dir: string, events: ReadonlyArray<unknown>) => {
  const file = join(dir, "stage1.jsonl");
  writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return parseStage(file);
};

const call = (id: string, command: string, _t: number) => ({
  type: "assistant",
  _t,
  message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
});

const output = (id: string, text: string, _t: number, is_error = false) => ({
  type: "user",
  _t,
  message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] },
});

describe("parseStage timing", () => {
  const stamped = [
    { type: "turn_start", _t: 1_000 },
    call("a", "npm install", 3_000),
    output("a", "ok", 43_000),
    call("b", "false", 46_000),
    output("b", "Exit code 1", 46_500, true),
    { type: "result", _t: 49_000, num_turns: 3, duration_ms: 48_000 },
  ];

  it("gives each command its own run time and the model time before it", ({ dir }) => {
    const [install, failing] = parse(dir, stamped).transcript;
    expect(install).toMatchObject({ kind: "command", thought: 2_000, ran: 40_000 });
    expect(failing).toMatchObject({ kind: "command", thought: 3_000, ran: 500 });
  });

  it("splits the stage into command, model and startup time", ({ dir }) => {
    expect(parse(dir, stamped).timing).toEqual({
      measured: true,
      commandMs: 40_500,
      modelMs: 5_000,
      startupMs: 2_500,
      waitMs: 0,
    });
  });

  it("counts the developer's answers apart from commands and failures", ({ dir }) => {
    const parsed = parse(dir, [{ type: "sim_user", text: "Next.js", _ms: 1_200 }, ...stamped]);
    expect(parsed.counts).toEqual({ questions: 1, commands: 2, failed: 1 });
    expect(parsed.timing.waitMs).toBe(1_200);
  });

  it("reports no timing for a run captured before lines were stamped", ({ dir }) => {
    const parsed = parse(dir, [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "a", name: "Bash", input: { command: "ls" } }],
        },
      },
      { type: "result", num_turns: 1, duration_ms: 1_000 },
    ]);
    expect(parsed.timing.measured).toBe(false);
    expect(parsed.transcript[0]).toMatchObject({ ran: null, thought: null });
  });

  it("charges the wait before the agent's init line to startup, not the model", ({ dir }) => {
    const { timing, transcript } = parse(dir, [
      { type: "turn_start", _t: 0 },
      { type: "system", subtype: "init", _t: 4_000 },
      call("a", "ls", 6_000),
      output("a", "ok", 7_000),
      { type: "result", _t: 7_500, num_turns: 1, duration_ms: 3_000 },
    ]);
    expect(transcript[0]).toMatchObject({ thought: 2_000, ran: 1_000 });
    expect(timing).toMatchObject({ modelMs: 2_000, commandMs: 1_000, startupMs: 4_500 });
  });

  it("runs a command that never reported back through the end of its turn", ({ dir }) => {
    const { timing, transcript } = parse(dir, [
      { type: "turn_start", _t: 0 },
      call("a", "sleep 999", 1_000),
      { type: "result", _t: 61_000, is_error: true, subtype: "turn_failed", num_turns: 0 },
    ]);
    expect(transcript[0]).toMatchObject({ ran: 60_000 });
    expect(timing.commandMs).toBe(60_000);
  });

  it("counts the developer's closing probe as waiting, not as a question", ({ dir }) => {
    const parsed = parse(dir, [...stamped, { type: "sim_done", _ms: 900 }]);
    expect(parsed.timing.waitMs).toBe(900);
    expect(parsed.counts.questions).toBe(0);
  });

  it("keeps a command's time when background task notices arrive while it runs", ({ dir }) => {
    const { timing, transcript } = parse(dir, [
      { type: "turn_start", _t: 0 },
      { type: "system", subtype: "init", _t: 500 },
      call("a", "npm install", 1_000),
      { type: "system", subtype: "task_started", _t: 2_000 },
      { type: "system", subtype: "task_notification", _t: 60_000 },
      output("a", "ok", 61_000),
      { type: "result", _t: 61_500, num_turns: 2 },
    ]);
    expect(transcript[0]).toMatchObject({ ran: 60_000 });
    expect(timing).toMatchObject({ commandMs: 60_000, modelMs: 500, startupMs: 1_000 });
  });
});
