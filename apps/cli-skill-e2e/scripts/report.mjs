// Renders the journey eval results into a self-contained tabbed HTML page:
// one tab per stage, each command shown with its real output underneath,
// with-skill vs baseline, plus per-stage tokens.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeConfig } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const OUT = process.env.OUT || join(root, "out");
const cfg = JSON.parse(readFileSync(join(root, "journey.config.json"), "utf8"));
const stages = cfg.stages;
const CONFIG_LABELS = { "with-skill": "With skill", baseline: "Baseline (no skill)" };

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function badge(status) {
  const m = { pass: ["ok", "PASS"], fail: ["no", "FAIL"], blocked: ["bl", "BLOCKED"] };
  const [c, t] = m[status] || ["no", "?"];
  return `<span class="b ${c}">${t}</span>`;
}

function cmdBlock(p) {
  const cmd = esc(p.cmd.replace(/\s+/g, " ").trim());
  let o = p.out || "(no output captured)";
  let trunc = "";
  if (o.length > 2500) {
    o = o.slice(0, 2500);
    trunc = "\n… (truncated)";
  }
  return `<div class="cmd"><div class="c">${cmd}</div><div class="o">${esc(o)}${esc(trunc)}</div></div>`;
}

function userBubble(text, label) {
  return `<div class="msg user"><h4>${esc(label)}</h4><div>${fmtMd(text)}</div></div>`;
}

function agentBubble(text) {
  return `<div class="msg agent"><h4>AGENT</h4><div>${fmtMd(text)}</div></div>`;
}

// Render the whole stage as a conversation, in order: the opening prompt, then
// each agent message / command and each simulated-user answer as they happened.
// This is what makes the back-and-forth visible — what the agent asked and what
// we answered — not just the commands it ended up running.
function convo(prompt, transcript) {
  const parts = [userBubble(prompt, "PROMPT")];
  for (const t of transcript) {
    if (t.kind === "command") parts.push(cmdBlock(t));
    else if (t.kind === "text") parts.push(agentBubble(t.text));
    else if (t.kind === "answer") parts.push(userBubble(t.text, "USER ANSWER"));
  }
  return parts.join("\n");
}

const CSS = `*{box-sizing:border-box}body{font:14px/1.55 -apple-system,Segoe UI,sans-serif;margin:0;color:#111;background:#f7f8fa}
header{background:#0b0f19;color:#fff;padding:18px 28px}header h1{margin:0;font-size:19px}header p{margin:4px 0 0;color:#9aa4b2;font-size:13px}
.tabs{display:flex;gap:4px;background:#0b0f19;padding:0 28px;flex-wrap:wrap}
.tab{padding:12px 20px;color:#9aa4b2;cursor:pointer;border-bottom:3px solid transparent;font-weight:600;font-size:13px}
.tab:hover{color:#fff}.tab.active{color:#fff;border-bottom-color:#6ee7b7}
.wrap{max-width:1000px;margin:0 auto;padding:24px 28px}
.stage-panel{display:none}.prompt{color:#555;margin:2px 0 18px;font-size:15px}
.cfg{margin:18px 0;border:1px solid #e5e7eb;border-radius:12px;background:#fff;overflow:hidden}
.cfg>summary{list-style:none;padding:12px 16px;font-weight:700;background:#f3f4f6;display:flex;align-items:center;gap:10px;cursor:pointer}
.cfg>summary::-webkit-details-marker{display:none}.cfg .body{padding:16px}
.b{font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;color:#fff;letter-spacing:.3px}
.b.ok{background:#16a34a}.b.no{background:#dc2626}.b.bl{background:#6b7280}
.why{color:#6b7280;font-size:12px;font-weight:500;margin-left:auto}
.cmd{margin:0 0 14px;border-radius:10px;overflow:hidden;border:1px solid #1f2937}
.cmd .c{background:#111827;color:#e5e7eb;padding:9px 13px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.cmd .c::before{content:"$ ";color:#6ee7b7;font-weight:700}
.cmd .o{background:#0b0f19;color:#cbd5e1;padding:11px 13px;font:11.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
.msg{border-radius:10px;padding:11px 14px;margin:0 0 12px}
.msg h4{margin:0 0 7px;font-size:11px;letter-spacing:.5px;font-weight:800}
.msg.user{background:#eff6ff;border:1px solid #bfdbfe}.msg.user h4{color:#1d4ed8}
.msg.agent{background:#fff;border:1px solid #e5e7eb}.msg.agent h4{color:#6b7280}
.msg code{background:#eef2ff;padding:1px 5px;border-radius:4px;font-size:12px}
.muted{color:#9ca3af}`;

const JS = `function show(n){document.querySelectorAll('.stage-panel').forEach(p=>p.style.display='none');document.getElementById('stage-'+n).style.display='block';document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.getElementById('tab-'+n).classList.add('active');}
window.addEventListener('DOMContentLoaded',()=>show(${stages[0].id}));`;

// Grade each config once.
const graded = {};
for (const c of cfg.configs) {
  const dir = join(OUT, c);
  graded[c] = existsSync(dir) ? gradeConfig(dir, stages) : null;
}

const tabs = stages.map((s) => `<div class="tab" id="tab-${s.id}" onclick="show(${s.id})">Stage ${s.id}</div>`).join("");

const panels = stages
  .map((s) => {
    const cfgHtml = cfg.configs
      .map((c) => {
        const rows = graded[c];
        if (!rows) return "";
        const r = rows.find((x) => x.stage === s.id);
        const open = c === "with-skill" ? " open" : "";
        return `<details class="cfg"${open}><summary>${esc(CONFIG_LABELS[c] || c)} ${badge(r.status)}<span class="why">${esc(r.why)} · ${r.turns} turns · <b>${r.tokens.toLocaleString()} tokens</b></span></summary><div class="body">${convo(s.prompt, r.parsed.transcript)}</div></details>`;
      })
      .join("");
    return `<div class="stage-panel" id="stage-${s.id}"><div class="prompt">${esc(s.title)}</div>${cfgHtml}</div>`;
  })
  .join("");

const doc = `<!doctype html><html><head><meta charset="utf-8"><title>zitadel-cli journey eval</title><style>${CSS}</style></head><body><header><h1>zitadel-cli skill — multi-stage journey eval</h1><p>One stateful run per config; the same project flows through ${stages.length} stages. Each stage is the full conversation — the prompt, what the agent asked, what the user answered, and every command with its real output.</p></header><div class="tabs">${tabs}</div><div class="wrap">${panels}</div><script>${JS}</script></body></html>`;

const dest = join(OUT, "journey.html");
writeFileSync(dest, doc);
console.log("report:", dest);
