// Runs inside the eval container. Drives each journey stage as a real
// multi-turn conversation so the agent can *prompt the user* — the whole point
// of the interactive flow. "Non-interactive" was only ever about how the agent
// drives the CLI (always `--non-interactive --json`); it never meant the agent
// can't ask the human. Here a simulated user answers those questions.
//
// Per stage:
//   1. Run the agent's turn (`claude -p`, stream-json) and append it to
//      /out/stage<N>.jsonl, capturing the session id and the agent's last text.
//   2. If the stage defines a `user` persona, ask a *simulated user* (a cheap,
//      skill-less Claude) to reply from that persona — or to say DONE when the
//      agent has finished and is asking nothing. Its answer is appended as a
//      `{"type":"sim_user","text":…}` line, then the agent is resumed
//      (`--resume <session>`) with it. Repeat until DONE or the Q&A cap.
//   3. Snapshot the human-user schema the stage produced.
//
// A stage with no `user` persona is a single agent turn — identical to the old
// one-shot behaviour, so concrete, no-choice stages (list, inspect) are
// unchanged.
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.OUT || "/out";
const WORK = process.env.WORK || "/work";
const MODEL = process.env.MODEL || "sonnet";
const SIM_MODEL = process.env.SIM_MODEL || "haiku";
const MAX_TURNS = process.env.MAX_TURNS || "40";
const MAX_QA = Number(process.env.MAX_QA || "6"); // cap on question/answer rounds
const cfg = JSON.parse(readFileSync("/harness/journey.config.json", "utf8"));

const DONE = "DONE";

/** One agent turn. Appends its stream-json to the stage file; returns the parsed turn. */
function agentTurn(stageFile, message, sessionId) {
  const args = [
    "-p",
    message,
    "--model",
    MODEL,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns",
    MAX_TURNS,
  ];
  if (sessionId) args.push("--resume", sessionId);
  const r = spawnSync("claude", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const stdout = r.stdout || "";
  appendFileSync(stageFile, stdout);
  let sid = sessionId;
  let lastText = "";
  let isError = r.status !== 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "system" && e.subtype === "init" && e.session_id) {
      sid = e.session_id;
    } else if (e.type === "assistant") {
      for (const b of e.message?.content ?? []) {
        if (b?.type === "text" && (b.text ?? "").trim()) lastText = b.text;
      }
    } else if (e.type === "result") {
      isError = e.is_error ?? isError;
    }
  }
  return { sessionId: sid, lastText, isError };
}

/** The simulated user's reply to the agent's latest message, or DONE. */
function simReply(persona, agentText) {
  const prompt = `You are the developer using an AI coding agent to add authentication to your app. Stay in character as the user — you do NOT run commands or write code, you only answer the agent.

Your preferences:
${persona}

The agent just said to you:
"""
${agentText}
"""

If the agent is asking you something, reply briefly and concretely from your preferences above — nothing more. Do not volunteer requirements it didn't ask about. If the agent has finished the task and is not asking you anything, reply with exactly: ${DONE}`;
  // A throwaway config dir keeps the globally-installed skill out of the
  // simulated user's context — it must answer as a human, not drive the CLI.
  const simHome = "/tmp/sim-home";
  mkdirSync(simHome, { recursive: true });
  const r = spawnSync(
    "claude",
    ["-p", prompt, "--model", SIM_MODEL, "--output-format", "json", "--max-turns", "1", "--dangerously-skip-permissions"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CLAUDE_CONFIG_DIR: simHome } },
  );
  try {
    return (JSON.parse(r.stdout || "{}").result || "").trim();
  } catch {
    return (r.stdout || "").trim();
  }
}

function snapshotSchema(stageId) {
  try {
    const dir = join(WORK, ".zitadel/schemas");
    const f = readdirSync(dir).find((n) => /human-user/.test(n) && n.endsWith(".json"));
    if (f) copyFileSync(join(dir, f), join(OUT, `after-stage${stageId}.json`));
  } catch {
    /* no schema yet — stage may not have created a project */
  }
}

for (const stage of cfg.stages) {
  const stageFile = join(OUT, `stage${stage.id}.jsonl`);
  let { sessionId, lastText, isError } = agentTurn(stageFile, stage.prompt, null);

  if (stage.user && !isError) {
    for (let round = 0; round < MAX_QA; round += 1) {
      const answer = simReply(stage.user, lastText);
      if (!answer || answer === DONE || answer.endsWith(DONE)) break;
      appendFileSync(stageFile, JSON.stringify({ type: "sim_user", text: answer }) + "\n");
      ({ sessionId, lastText, isError } = agentTurn(stageFile, answer, sessionId));
      if (isError) break;
    }
  }

  snapshotSchema(stage.id);
}
