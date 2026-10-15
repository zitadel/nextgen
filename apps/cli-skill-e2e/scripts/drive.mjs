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
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { evalAssertion } from "./lib.mjs";

const OUT = process.env.OUT || "/out";
const WORK = process.env.WORK || "/work";
const MODEL = process.env.MODEL || "sonnet";
const SIM_MODEL = process.env.SIM_MODEL || "haiku";
const CONFIG = process.env.CONFIG || "";
const IS_BASELINE = CONFIG === "baseline";
// With the skill the agent legitimately needs many turns (it scaffolds a whole
// app in stage 1); the baseline gets a tight cap, because a no-skill agent that
// hasn't found the CLI in a handful of turns won't in forty — that's the
// failure we're measuring, not something to wait out. The baseline also skips
// the simulated-user Q&A entirely (see below): one short attempt, then it's a
// failed stage. Without that, the agent burns minutes and 300k+ tokens on a
// polite multi-round conversation it can never act on.
const MAX_TURNS = IS_BASELINE
  ? process.env.BASELINE_MAX_TURNS || "5"
  : process.env.MAX_TURNS || "40";
const MAX_QA = Number(process.env.MAX_QA || "6"); // cap on question/answer rounds
// Wall-clock ceiling per `claude -p` call. `--max-turns` caps the reasoning
// loop but cannot catch a turn that *hangs* (a wedged network call, a stuck
// child process): that stalls inside a single turn, forever. This timeout kills
// such a call so the stage fails fast instead of the whole run hanging.
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS || 7 * 60 * 1000);
const cfg = JSON.parse(readFileSync("/harness/journey.config.json", "utf8"));
// The CLI used for outcome assertions — the same package/tag the agent drives,
// pointed at the live instance in /work (it reads the server + creds from there).
const CLI_SPEC = process.env.CLI_SPEC || cfg.cliSpec || "@zitadel/cli@alpha";

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
  const r = spawnSync("claude", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: CALL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const stdout = r.stdout || "";
  appendFileSync(stageFile, stdout);
  // A timeout shows up as a kill signal (SIGKILL) or an ETIMEDOUT error, with a
  // null exit status — treat it as a failed turn so the journey aborts.
  const timedOut = Boolean(r.signal) || r.error?.code === "ETIMEDOUT";
  if (timedOut) {
    console.log(`[drive] claude call exceeded ${CALL_TIMEOUT_MS}ms wall clock — killed`);
  }
  let sid = sessionId;
  let lastText = "";
  let isError = timedOut || r.status !== 0;
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
    [
      "-p",
      prompt,
      "--model",
      SIM_MODEL,
      "--output-format",
      "json",
      "--max-turns",
      "1",
      "--dangerously-skip-permissions",
    ],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: Math.min(CALL_TIMEOUT_MS, 2 * 60 * 1000),
      killSignal: "SIGKILL",
      env: { ...process.env, CLAUDE_CONFIG_DIR: simHome },
    },
  );
  try {
    return (JSON.parse(r.stdout || "{}").result || "").trim();
  } catch {
    return (r.stdout || "").trim();
  }
}

/**
 * Has a Zitadel project actually been established in the workspace yet? The
 * journey is stateful — every stage after setup needs the project the setup
 * stage created. If setup never produced one (the baseline's usual fate: it
 * can't find the CLI), the later stages have nothing to act on, so we stop
 * rather than grind each one to its turn cap.
 */
function hasProject() {
  try {
    if (existsSync(join(WORK, "zitadel.json"))) return true;
    const dir = join(WORK, ".zitadel/schemas");
    return readdirSync(dir).some((n) => /human-user/.test(n) && n.endsWith(".json"));
  } catch {
    return false;
  }
}

/**
 * Outcome grading. After a stage, ask the LIVE instance what it actually holds
 * and check the stage's declared assertions against it — not what the agent
 * said or wrote. Read commands are deduped per stage (several assertions share
 * one `get`), run in /work so the CLI resolves the same server + creds the agent
 * deployed to, and the results land in `asserts-stage<N>.json` for the grader
 * and the report. A failed/empty command fails its assertions (the baseline,
 * with no server, fails them all — which is the point).
 */
function runAsserts(stage) {
  if (!stage.assert?.length) return;
  const cache = new Map();
  const fetch = (get) => {
    if (cache.has(get)) return cache.get(get);
    const r = spawnSync(
      "npx",
      ["-y", CLI_SPEC, ...get.split(" ").filter(Boolean), "--non-interactive", "--json"],
      {
        cwd: WORK,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: Math.min(CALL_TIMEOUT_MS, 2 * 60 * 1000),
        killSignal: "SIGKILL",
      },
    );
    let out;
    if (r.status === 0) {
      try {
        out = { json: JSON.parse(r.stdout || "{}") };
      } catch {
        out = { err: "non-JSON output" };
      }
    } else {
      out = { err: (r.stderr || r.stdout || `exit ${r.status}`).trim().slice(0, 300) };
    }
    cache.set(get, out);
    return out;
  };
  const results = stage.assert.map((a) => {
    const { json, err } = fetch(a.get);
    if (err || json === undefined) {
      return { name: a.name, passed: false, evidence: `\`${a.get}\` → ${err || "no data"}` };
    }
    const { passed, actual } = evalAssertion(json, a);
    const shownPath = Array.isArray(a.path) ? a.path.join(" | ") : a.path;
    return { name: a.name, passed, evidence: `\`${a.get}\` → ${shownPath} = ${actual}` };
  });
  writeFileSync(
    join(OUT, `asserts-stage${stage.id}.json`),
    JSON.stringify({ stage: stage.id, results }, null, 2),
  );
  // Dump the raw responses too: when an assertion's `path` is wrong, the pass/
  // fail line can't show you where the value really lives — this can.
  const raw = Object.fromEntries([...cache].map(([get, out]) => [get, out.json ?? { err: out.err }]));
  writeFileSync(
    join(OUT, `asserts-raw-stage${stage.id}.json`),
    JSON.stringify(raw, null, 2),
  );
  const pass = results.filter((r) => r.passed).length;
  console.log(`[drive] stage ${stage.id} live-instance assertions: ${pass}/${results.length}`);
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

  // Only the real (with-skill) agent gets the interactive Q&A. The baseline
  // gets a single capped attempt — a no-skill agent that hasn't found the CLI
  // doesn't earn five rounds of the user spelling out requirements it can't use.
  if (stage.user && !isError && !IS_BASELINE) {
    for (let round = 0; round < MAX_QA; round += 1) {
      const answer = simReply(stage.user, lastText);
      if (!answer || answer === DONE || answer.endsWith(DONE)) break;
      appendFileSync(stageFile, `${JSON.stringify({ type: "sim_user", text: answer })}\n`);
      ({ sessionId, lastText, isError } = agentTurn(stageFile, answer, sessionId));
      if (isError) break;
    }
  }

  snapshotSchema(stage.id);
  runAsserts(stage);

  // The journey is a chain. Once a stage leaves no project behind, every later
  // stage would just repeat the same doomed search — abort and let the grader
  // mark the rest failed (their stage files stay absent, which parseStage reads
  // as empty). This is what turns the baseline from ~5× a full turn budget into
  // a single failed setup stage.
  if (!hasProject()) {
    console.log(
      `[drive] stage ${stage.id} established no project; aborting remaining journey stages`,
    );
    break;
  }
}
