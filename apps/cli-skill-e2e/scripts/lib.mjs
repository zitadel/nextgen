// Shared parsing + grading for the zitadel-cli skill journey eval.
// Pure Node, no deps, so Vitest and the report generator both use it.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Parse one stage trajectory (stream-json JSONL) into a conversation.
 *
 * A stage may be multi-turn: the agent's `claude -p` stream, then a
 * `{"type":"sim_user","text":…}` line for the simulated user's answer, then the
 * resumed agent's stream, and so on. So the file can hold several `result`
 * events (one per agent turn) interleaved with `sim_user` lines. We walk it in
 * order and build:
 *   - `transcript`: every turn in sequence — agent text, agent commands (with
 *     their output), and the simulated user's answers — for the report's
 *     conversation view.
 *   - `pairs`: just the command/output pairs across all turns, for grading.
 *   - `final`: the agent's last text block (its closing answer).
 *   - `result`: an aggregate across all agent turns — `is_error` from the last
 *     turn, `num_turns` and `usage` summed — so token/turn totals cover the
 *     whole conversation, not just its final leg.
 */
export function parseStage(file) {
  const empty = { pairs: [], transcript: [], final: "", result: {} };
  if (!existsSync(file)) return empty;
  const transcript = [];
  const cmdById = new Map();
  let final = "";
  const results = [];
  // Track the last entry pushed in the current agent turn so we can attribute
  // that turn's `result.duration_ms` to it (shown per message in the report).
  let lastInTurn = null;
  const push = (entry) => {
    transcript.push(entry);
    lastInTurn = entry;
    return entry;
  };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "sim_user") {
      push({ role: "user", kind: "answer", text: e.text ?? "" });
    } else if (e.type === "assistant") {
      for (const b of e.message?.content ?? []) {
        if (b?.type === "tool_use" && b.name === "Bash") {
          const entry = push({
            role: "agent",
            kind: "command",
            cmd: b.input?.command ?? "",
            out: "",
          });
          cmdById.set(b.id, entry);
        } else if (b?.type === "text" && (b.text ?? "").trim()) {
          final = b.text ?? "";
          push({ role: "agent", kind: "text", text: b.text ?? "" });
        }
      }
    } else if (e.type === "user") {
      const content = e.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "tool_result") {
            const c = b.content;
            const out = typeof c === "string" ? c : (c ?? []).map((x) => x?.text ?? "").join("");
            const entry = cmdById.get(b.tool_use_id);
            if (entry) {
              entry.out = out;
              // A failed Bash call comes back with `is_error`; Claude Code puts
              // the status in the output text ("Exit code N"), so recover the
              // number when it's there, else mark a non-zero exit we can't name.
              entry.err = Boolean(b.is_error);
              const m = /Exit code (\d+)/i.exec(out);
              entry.exit = m ? Number(m[1]) : b.is_error ? null : 0;
            }
          }
        }
      }
    } else if (e.type === "result") {
      results.push(e);
      if (lastInTurn && lastInTurn.ms == null) lastInTurn.ms = e.duration_ms ?? null;
      lastInTurn = null; // next turn attributes to its own last entry
    }
  }
  const pairs = transcript
    .filter((t) => t.kind === "command")
    .map((t) => ({ cmd: t.cmd, out: t.out }));
  const result = aggregateResults(results);
  return { pairs, transcript, final, result };
}

/** Collapse per-turn `result` events into one: last turn's error, summed turns/usage/time. */
function aggregateResults(results) {
  if (!results.length) return {};
  const last = results[results.length - 1];
  const usage = {};
  let numTurns = 0;
  let durationMs = 0;
  for (const r of results) {
    numTurns += r.num_turns ?? 0;
    durationMs += r.duration_ms ?? 0;
    for (const [k, v] of Object.entries(r.usage ?? {})) {
      if (typeof v === "number") usage[k] = (usage[k] ?? 0) + v;
    }
  }
  return {
    is_error: last.is_error ?? false,
    num_turns: numTurns || last.num_turns,
    duration_ms: durationMs,
    usage,
  };
}

export function tokens(result) {
  const u = result?.usage ?? {};
  return (
    (u.input_tokens | 0) +
    (u.output_tokens | 0) +
    (u.cache_read_input_tokens | 0) +
    (u.cache_creation_input_tokens | 0)
  );
}

function readIf(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Resolve a dotted path against a parsed CLI `--json` response. The CLI wraps
 * payloads in an envelope (`{ data: … }`), and list responses nest the array
 * under a named key, so we try the object itself and its `.data` and return the
 * first place the path resolves — the caller writes `projects` or
 * `schema.properties.firstName`, not the envelope boilerplate.
 */
export function resolvePath(obj, path) {
  const follow = (base) => {
    let cur = base;
    for (const key of path.split(".")) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[key];
    }
    return cur;
  };
  const direct = follow(obj);
  if (direct !== undefined) return direct;
  if (obj && typeof obj === "object" && "data" in obj) return follow(obj.data);
  return undefined;
}

/**
 * Evaluate one assertion against a parsed response. Outcome grading: we read
 * what the live instance actually holds, not what the agent said it did.
 * ops: exists | eq | neq | count-eq | count-gte.
 */
export function evalAssertion(parsed, a) {
  // `path` may be a list of alternatives (e.g. a field the CLI spells two ways)
  // — the first that resolves wins, so an assertion tracks the capability, not
  // one spelling.
  const paths = Array.isArray(a.path) ? a.path : [a.path];
  let actual;
  for (const p of paths) {
    actual = resolvePath(parsed, p);
    if (actual !== undefined) break;
  }
  const arr = Array.isArray(actual) ? actual : undefined;
  let passed = false;
  switch (a.op) {
    case "exists":
      passed = actual !== undefined && actual !== null;
      break;
    case "eq":
      passed = actual === a.value;
      break;
    case "neq":
      passed = actual !== a.value;
      break;
    case "count-eq":
      passed = arr !== undefined && arr.length === a.value;
      break;
    case "count-gte":
      passed = arr !== undefined && arr.length >= a.value;
      break;
    default:
      passed = false;
  }
  const shown = arr !== undefined ? `len ${arr.length}` : JSON.stringify(actual);
  return { passed, actual: shown };
}

/** Load the live-instance assertion results a stage's run captured, if any. */
function loadAsserts(cfgDir, stageId) {
  const txt = readIf(join(cfgDir, `asserts-stage${stageId}.json`));
  if (!txt) return null;
  try {
    return JSON.parse(txt).results ?? null;
  } catch {
    return null;
  }
}

/**
 * Grade one stage. Outcome-first: if the stage declares `assert`s, it passes
 * only when the agent's turn didn't error AND every assertion against the live
 * instance held. Stages with no server-assertable outcome (e.g. "is this a
 * client id?", a reasoning answer) fall back to a transcript heuristic by
 * `grade`. Returns {status, why, asserts?}. status ∈ pass | fail | blocked.
 */
export function gradeStage(stage, cfgDir, parsed, stage1ok) {
  const rule = stage.grade;
  const { pairs, final, result } = parsed;
  const ok = !(result?.is_error ?? true);
  const blob = `${pairs.map((p) => `${p.cmd} ${p.out}`).join(" ")} ${final}`;
  const isFirst = rule === "setup";

  // Outcome grading from the live-instance assertions captured during the run.
  if (stage.assert?.length) {
    if (!isFirst && !stage1ok)
      return {
        status: "blocked",
        why: "stage 1 produced no project, so there's nothing to assert against",
      };
    const results = loadAsserts(cfgDir, stage.id);
    if (!results)
      return { status: "fail", why: "assertions never ran (no server state captured)", asserts: [] };
    const failed = results.filter((r) => !r.passed);
    if (ok && failed.length === 0)
      return {
        status: "pass",
        why: `${results.length}/${results.length} live-instance checks passed`,
        asserts: results,
      };
    const why = !ok
      ? "the agent's turn errored"
      : `failed: ${failed.map((r) => r.name).join("; ")}`;
    return { status: "fail", why, asserts: results };
  }

  if (!stage1ok && !isFirst)
    return { status: "blocked", why: "stage 1 produced no project, so there's nothing to act on" };

  // Fallback for stages with no server-assertable outcome. "Does my project
  // have a client id/secret?" is a reasoning answer (the trap: a project
  // id/secret is NOT an OAuth client id/secret), so we check the agent looked
  // and gave a clear yes/no — not the live instance.
  if (rule === "inspect-credentials") {
    const inspected =
      /variables|\.zitadel\/secret|client[_ ]?id|client[_ ]?secret|\.env|CLIENT_ID/i.test(blob);
    const answered = /\byes\b|\bno\b|client id|client secret|credential/i.test(final);
    return ok && inspected && answered
      ? { status: "pass", why: "inspected credentials and gave an evidenced answer" }
      : { status: "fail", why: "did not inspect credentials / no clear answer" };
  }
  return { status: "fail", why: `no assertions and no fallback rule for "${rule}"` };
}

/** Grade every stage for a config dir. Returns [{stage, status, why, asserts, parsed, …}]. */
export function gradeConfig(cfgDir, stages) {
  const parsedByStage = {};
  for (const s of stages) parsedByStage[s.id] = parseStage(join(cfgDir, `stage${s.id}.jsonl`));
  const s1 = gradeStage(stages[0], cfgDir, parsedByStage[stages[0].id], true);
  const stage1ok = s1.status === "pass";
  return stages.map((s) => {
    const parsed = parsedByStage[s.id];
    const { status, why, asserts } = gradeStage(s, cfgDir, parsed, stage1ok);
    return {
      stage: s.id,
      title: s.title,
      status,
      why,
      asserts: asserts ?? null,
      parsed,
      tokens: tokens(parsed.result),
      turns: parsed.result?.num_turns ?? "?",
      ms: parsed.result?.duration_ms ?? 0,
    };
  });
}
