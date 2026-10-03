// Shared parsing + grading for the zitadel-cli skill journey eval.
// Pure Node, no deps, so Vitest and the report generator both use it.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Parse one stage trajectory (stream-json JSONL) into command/output pairs. */
export function parseStage(file) {
  const empty = { pairs: [], final: "", result: {} };
  if (!existsSync(file)) return empty;
  const order = [];
  const outs = new Map();
  let final = "";
  let result = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "assistant") {
      for (const b of e.message?.content ?? []) {
        if (b?.type === "tool_use" && b.name === "Bash") order.push([b.id, b.input?.command ?? ""]);
        else if (b?.type === "text") final = b.text ?? "";
      }
    } else if (e.type === "user") {
      const content = e.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "tool_result") {
            const c = b.content;
            outs.set(b.tool_use_id, typeof c === "string" ? c : (c ?? []).map((x) => x?.text ?? "").join(""));
          }
        }
      }
    } else if (e.type === "result") {
      result = e;
    }
  }
  const pairs = order.map(([id, cmd]) => ({ cmd, out: outs.get(id) ?? "" }));
  return { pairs, final, result };
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
  const blob = pairs.map((p) => `${p.cmd} ${p.out}`).join(" ") + " " + final;

  if (rule === "setup") {
    const sd = join(cfgDir, "artifacts/.zitadel/schemas");
    let txt = "";
    if (existsSync(sd)) {
      const f = readdirSync(sd).find((n) => /human-user/.test(n) && n.endsWith(".json"));
      if (f) txt = readIf(join(sd, f));
    }
    if (ok && txt.includes("givenName") && txt.includes("familyName"))
      return { status: "pass", why: "schema has givenName + familyName; applied" };
    return { status: "fail", why: "no project created (couldn't find the CLI, or schema missing fields)" };
  }

  if (!stage1ok) return { status: "blocked", why: "stage 1 produced no project, so there's nothing to act on" };

  if (rule === "list-projects") {
    const listed = /projects?\s+list|projects\b/.test(blob);
    const found = /proj_[0-9A-Za-z]{6,}|"count":\s*[1-9]|\b1 project\b|found[^.]*project/i.test(blob);
    return ok && listed && found
      ? { status: "pass", why: "ran a projects list and the project shows up" }
      : { status: "fail", why: "listed but no project found, or errored" };
  }
  if (rule === "inspect-credentials") {
    const inspected = /variables|\.zitadel\/secret|client[_ ]?id|client[_ ]?secret|\.env|CLIENT_ID/i.test(blob);
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
    };
  });
}
