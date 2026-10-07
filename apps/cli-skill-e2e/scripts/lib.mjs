// Shared parsing + grading for the zitadel-cli skill journey eval.
// Pure Node, no deps, so Vitest and the report generator both use it.
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
 * Grade one stage against ground truth. Returns {status, why}.
 * status ∈ "pass" | "fail" | "blocked". `grade` is the rule name from the config.
 */
export function gradeStage(rule, cfgDir, parsed, stage1ok) {
  const { pairs, final, result } = parsed;
  const ok = !(result?.is_error ?? true);
  const blob = `${pairs.map((p) => `${p.cmd} ${p.out}`).join(" ")} ${final}`;

  if (rule === "setup") {
    const sd = join(cfgDir, "artifacts/.zitadel/schemas");
    let txt = "";
    if (existsSync(sd)) {
      const f = readdirSync(sd).find((n) => /human-user/.test(n) && n.endsWith(".json"));
      if (f) txt = readIf(join(sd, f));
    }
    // The CLI's human-user schema names the first/last name fields
    // `firstName`/`lastName` (older builds used `givenName`/`familyName`);
    // accept either so the grade tracks the capability, not one spelling.
    const hasFirst = /firstName|givenName/.test(txt);
    const hasLast = /lastName|familyName/.test(txt);
    if (ok && hasFirst && hasLast)
      return { status: "pass", why: "schema has first- + last-name fields; applied" };
    return {
      status: "fail",
      why: "no project created (couldn't find the CLI, or schema missing fields)",
    };
  }

  if (!stage1ok)
    return { status: "blocked", why: "stage 1 produced no project, so there's nothing to act on" };

  if (rule === "list-projects") {
    const listed = /projects?\s+list|projects\b/.test(blob);
    const found = /proj_[0-9A-Za-z]{6,}|"count":\s*[1-9]|\b1 project\b|found[^.]*project/i.test(
      blob,
    );
    return ok && listed && found
      ? { status: "pass", why: "ran a projects list and the project shows up" }
      : { status: "fail", why: "listed but no project found, or errored" };
  }
  if (rule === "inspect-credentials") {
    const inspected =
      /variables|\.zitadel\/secret|client[_ ]?id|client[_ ]?secret|\.env|CLIENT_ID/i.test(blob);
    const answered = /\byes\b|\bno\b|client id|client secret|credential/i.test(final);
    return ok && inspected && answered
      ? { status: "pass", why: "inspected credentials and gave an evidenced answer" }
      : { status: "fail", why: "did not inspect credentials / no clear answer" };
  }
  if (rule === "schema-has-phone") {
    const txt = readIf(join(cfgDir, "after-stage4.json"));
    const hasPhone = /phone|telephone|mobile/i.test(txt);
    const applied = /\bapply\b/.test(blob);
    return ok && hasPhone && applied
      ? { status: "pass", why: "phone field is in the schema and was deployed" }
      : { status: "fail", why: "phone field not in schema, or not deployed" };
  }
  if (rule === "passkey-enabled") {
    const txt = readIf(join(cfgDir, "after-stage5.json"));
    const pkOn = /"passkey"\s*:\s*\{[^}]*"enabled"\s*:\s*true/is.test(txt);
    const applied = /\bapply\b/.test(blob);
    return ok && pkOn && applied
      ? { status: "pass", why: "passkeys enabled in the schema and deployed" }
      : { status: "fail", why: "passkeys not enabled in schema, or not deployed" };
  }
  return { status: "fail", why: `unknown grade rule: ${rule}` };
}

/** Grade every stage for a config dir. Returns [{stage, status, why, parsed, tokens, turns}]. */
export function gradeConfig(cfgDir, stages) {
  const parsedByStage = {};
  for (const s of stages) parsedByStage[s.id] = parseStage(join(cfgDir, `stage${s.id}.jsonl`));
  const s1 = gradeStage("setup", cfgDir, parsedByStage[stages[0].id], true);
  const stage1ok = s1.status === "pass";
  return stages.map((s) => {
    const parsed = parsedByStage[s.id];
    const { status, why } = gradeStage(s.grade, cfgDir, parsed, stage1ok);
    return {
      stage: s.id,
      title: s.title,
      status,
      why,
      parsed,
      tokens: tokens(parsed.result),
      turns: parsed.result?.num_turns ?? "?",
      ms: parsed.result?.duration_ms ?? 0,
    };
  });
}
