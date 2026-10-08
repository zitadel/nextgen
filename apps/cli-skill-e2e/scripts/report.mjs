// Renders the journey eval results into a self-contained, offline HTML report:
// one tab per stage, the full agent↔user conversation with every command and
// its output, with-skill vs baseline, per-stage and per-turn timings, and
// run metadata (when, where, which commit). Everything is inlined so the file
// can be opened from disk or shared as-is.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import { gradeConfig } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const OUT = process.env.OUT || join(root, "out");
const cfg = JSON.parse(readFileSync(join(root, "journey.config.json"), "utf8"));
const stages = cfg.stages;
const CONFIG_LABELS = { "with-skill": "With skill", baseline: "Baseline (no skill)" };

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// --- Run metadata -----------------------------------------------------------
const git = (args) => {
  try {
    return execSync(`git ${args}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};
const meta = {
  generatedAt: new Date().toISOString(),
  host: hostname(),
  node: process.version,
  model: process.env.MODEL || "sonnet",
  simModel: process.env.SIM_MODEL || "haiku",
  branch: process.env.BRANCH || git("rev-parse --abbrev-ref HEAD"),
  commit: git("rev-parse --short HEAD"),
  commitFull: git("rev-parse HEAD"),
  dirty: Boolean(git("status --porcelain")),
};

// --- Markdown (sanitised) ----------------------------------------------------
// Agent/user text is model output, not trusted HTML: `marked` passes raw HTML
// through, and teardown auto-opens the report, so an unsanitised transcript
// could execute script in the local file origin. Render markdown, then strip
// everything that isn't a safe formatting tag.
marked.setOptions({ gfm: true });
const SANITIZE = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "b",
    "i",
    "s",
    "del",
    "code",
    "pre",
    "kbd",
    "blockquote",
    "a",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "span",
  ],
  allowedAttributes: { a: ["href", "title"], th: ["align"], td: ["align"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
  },
};
const mdToHtml = (text) => sanitizeHtml(marked.parse(String(text ?? "")), SANITIZE);

// --- Timing helpers (server fallback; the browser re-formats with Intl) ------
const durFallback = (ms) => {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h ? `${h}h ` : ""}${m ? `${m}m ` : ""}${r}s`;
};
const dur = (ms) => (ms ? `<span class="dur" data-ms="${ms}">${esc(durFallback(ms))}</span>` : "");
const timeEl = (iso) =>
  `<time class="ts" datetime="${esc(iso)}" data-iso="${esc(iso)}">${esc(iso)}</time>`;

function badge(status) {
  const m = { pass: ["ok", "Pass"], fail: ["no", "Fail"], blocked: ["bl", "Blocked"] };
  const [c, t] = m[status] || ["no", "?"];
  return `<span class="b ${c}" role="status">${t}</span>`;
}

function cmdBlock(p) {
  const cmd = esc(p.cmd.replace(/\s+/g, " ").trim());
  let o = p.out || "(no output captured)";
  let trunc = "";
  if (o.length > 2500) {
    o = o.slice(0, 2500);
    trunc = "\n… (truncated)";
  }
  const failed = Boolean(p.err);
  const codeLabel = p.exit === 0 ? "exit 0" : p.exit != null ? `exit ${p.exit}` : "exit ≠ 0";
  const badge = `<span class="exit ${failed ? "err" : "ok"}">${esc(codeLabel)}</span>`;
  return `<div class="cmd ${failed ? "err" : "ok"}"><div class="c"><code>${cmd}</code>${badge}</div><pre class="o">${esc(o)}${esc(trunc)}</pre></div>`;
}

function bubble(kind, label, text, ms) {
  const time = ms ? `<span class="turn-time" title="agent turn time">${dur(ms)}</span>` : "";
  return `<div class="msg ${kind}"><div class="lbl">${esc(label)}${time}</div><div class="md">${mdToHtml(text)}</div></div>`;
}

// The whole stage as a conversation, in order: opening prompt, then each agent
// message / command and each simulated-user answer as they happened.
function convo(prompt, transcript) {
  const parts = [bubble("prompt", "Prompt", prompt)];
  for (const t of transcript) {
    if (t.kind === "command") parts.push(cmdBlock(t));
    else if (t.kind === "text") parts.push(bubble("agent", "Agent", t.text, t.ms));
    else if (t.kind === "answer") parts.push(bubble("answer", "User answer", t.text));
  }
  return parts.join("\n");
}

// The live-instance outcome checks for a stage: what the harness asked the
// running server after the agent's turn, and whether reality matched.
function assertsBlock(asserts) {
  if (!asserts || !asserts.length) return "";
  const items = asserts
    .map(
      (a) =>
        `<li class="asrt ${a.passed ? "ok" : "no"}"><span class="am">${a.passed ? "✓" : "✗"}</span><span class="an">${esc(a.name)}</span><span class="ae">${mdToHtml(a.evidence || "")}</span></li>`,
    )
    .join("");
  return `<div class="asserts"><div class="asserts-h">Live-instance checks</div><ul class="asrt-list">${items}</ul></div>`;
}

// --- Grade each config once --------------------------------------------------
const graded = {};
for (const c of cfg.configs) {
  const dir = join(OUT, c);
  graded[c] = existsSync(dir) ? gradeConfig(dir, stages) : null;
}

const score = (c) => {
  const rows = graded[c] || [];
  return { pass: rows.filter((r) => r.status === "pass").length, total: rows.length };
};

// --- HTML --------------------------------------------------------------------
const metaDl = (extra = "") => `<dl class="meta">
  <div><dt>Generated</dt><dd>${timeEl(meta.generatedAt)}</dd></div>
  <div><dt>Commit</dt><dd><code>${esc(meta.commit || "—")}</code>${meta.dirty ? ' <span class="warn">(working tree modified)</span>' : ""}</dd></div>
  <div><dt>Branch</dt><dd><code>${esc(meta.branch || "—")}</code></dd></div>
  <div><dt>Host</dt><dd>${esc(meta.host)}</dd></div>
  <div><dt>Agent model</dt><dd>${esc(meta.model)}</dd></div>
  ${extra}
</dl>`;

const scoreboard = cfg.configs
  .map((c) => {
    const { pass, total } = score(c);
    return `<span class="score"><b>${esc(CONFIG_LABELS[c] || c)}</b> ${pass}/${total} passed</span>`;
  })
  .join("");

const tabs = stages
  .map(
    (s, i) =>
      `<button class="tab" role="tab" id="tab-${s.id}" aria-controls="stage-${s.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" onclick="show(${s.id})">Stage ${s.id}</button>`,
  )
  .join("");

const panels = stages
  .map((s, i) => {
    const cfgHtml = cfg.configs
      .map((c) => {
        const rows = graded[c];
        if (!rows) return "";
        const r = rows.find((x) => x.stage === s.id);
        const t = r.ms ? ` · ${dur(r.ms)}` : "";
        return `<details class="cfg"${c === "with-skill" ? " open" : ""}><summary>${badge(r.status)}<span class="cfg-name">${esc(CONFIG_LABELS[c] || c)}</span><span class="why">${esc(r.why)}</span><span class="stat">${r.turns} turns · ${r.tokens.toLocaleString()} tokens${t}</span></summary><div class="body">${assertsBlock(r.asserts)}${convo(s.prompt, r.parsed.transcript)}</div></details>`;
      })
      .join("");
    return `<section class="stage-panel" role="tabpanel" id="stage-${s.id}" aria-labelledby="tab-${s.id}" tabindex="0"${i === 0 ? "" : " hidden"}><h2 class="stage-head">Stage ${s.id}: ${esc(s.title)}</h2>${cfgHtml}</section>`;
  })
  .join("");

const CSS = `
:root{
  --bg:#f6f7f9; --fg:#111827; --muted:#6b7280; --card:#ffffff; --border:#e5e7eb;
  --chrome:#0b0f19; --chrome-fg:#e5e7eb; --chrome-muted:#9aa4b2; --accent:#34d399;
  --term-bg:#0b0f19; --term-fg:#cbd5e1; --cmd-bg:#111827; --code-bg:#eef2ff;
  --th-bg:#f3f4f6;
  /* Speaker colour-coding. Prompt leads (indigo), the user's follow-up answers
     are the same family but lighter (blue), the agent is a distinct hue (teal). */
  --prompt:#4f46e5; --prompt-bg:#eef2ff; --prompt-fg:#3730a3;
  --answer:#2563eb; --answer-bg:#eff6ff; --answer-fg:#1d4ed8;
  --agent:#0d9488; --agent-bg:#f0fdfa; --agent-fg:#0f766e;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0b0f17; --fg:#e5e7eb; --muted:#9aa4b2; --card:#111827; --border:#1f2937;
  --chrome:#05080f; --code-bg:#1e293b; --th-bg:#1e293b;
  --prompt:#818cf8; --prompt-bg:#1a1b3a; --prompt-fg:#c7d2fe;
  --answer:#60a5fa; --answer-bg:#0e1b2e; --answer-fg:#bfdbfe;
  --agent:#2dd4bf; --agent-bg:#0c2420; --agent-fg:#99f6e4;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{font:14px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:var(--fg);background:var(--bg)}
a{color:inherit}
.banner{background:var(--chrome);color:var(--chrome-fg);padding:20px clamp(16px,4vw,32px)}
.banner h1{margin:0;font-size:clamp(17px,2.5vw,21px);letter-spacing:-.01em}
.banner .sub{margin:6px 0 0;color:var(--chrome-muted);font-size:13px;max-width:70ch}
.scoreboard{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0 2px}
.score{font-size:13px;color:var(--chrome-muted)}.score b{color:#fff;font-weight:700}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 22px;margin:14px 0 0;padding:0}
.meta div{min-width:0}
.meta dt{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--chrome-muted);margin:0}
.meta dd{margin:2px 0 0;font-size:13px;color:#fff;word-break:break-word}
.meta code{font:12px ui-monospace,Menlo,monospace}
.meta .warn{color:#fca5a5;font-size:11px}
.tabs{display:flex;gap:2px;background:var(--chrome);padding:0 clamp(16px,4vw,32px);flex-wrap:wrap;position:sticky;top:0;z-index:5}
.tab{appearance:none;background:none;border:0;border-bottom:3px solid transparent;color:var(--chrome-muted);padding:12px 18px;font:600 13px/1 inherit;cursor:pointer}
.tab:hover{color:#fff}
.tab[aria-selected="true"]{color:#fff;border-bottom-color:var(--accent)}
.tab:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
main{max-width:1000px;margin:0 auto;padding:24px clamp(16px,4vw,32px)}
.stage-panel:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:8px}
.stage-head{font-size:17px;margin:0 0 20px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.cfg{margin:0 0 24px;border:1px solid var(--border);border-radius:12px;background:var(--card);overflow:hidden}
.cfg>summary{list-style:none;padding:14px 18px;display:flex;align-items:center;gap:12px;cursor:pointer;flex-wrap:wrap}
.cfg>summary::-webkit-details-marker{display:none}
.cfg>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.cfg-name{font-weight:700;font-size:14.5px}
.cfg .body{padding:20px;border-top:1px solid var(--border)}
.b{font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;color:#fff;letter-spacing:.3px}
.b.ok{background:#16a34a}.b.no{background:#dc2626}.b.bl{background:#6b7280}
.why{color:var(--muted);font-size:12.5px}
.stat{color:var(--muted);font-size:12px;margin-left:auto;white-space:nowrap}
.dur{font-variant-numeric:tabular-nums}
.asserts{margin:0 0 20px;border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--panel)}
.asserts-h{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px}
.asrt-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.asrt{display:grid;grid-template-columns:18px 1fr;gap:4px 8px;align-items:baseline;font-size:13px}
.asrt .am{font-weight:800;text-align:center}
.asrt.ok .am{color:#16a34a}.asrt.no .am{color:#dc2626}
.asrt.no .an{font-weight:600}
.asrt .ae{grid-column:2;color:var(--muted);font-size:11.5px}
.asrt .ae code{font-size:11px}
.cmd{margin:0 0 18px;border-radius:10px;overflow:hidden;border:1px solid var(--cmd-bg)}
.cmd .c{background:var(--cmd-bg);color:#e5e7eb;padding:10px 14px;font:12px/1.5 ui-monospace,Menlo,monospace;display:flex;gap:12px;align-items:flex-start}
.cmd .c code{background:none;color:inherit;font:inherit;white-space:pre-wrap;word-break:break-word;flex:1 1 auto;min-width:0}
.cmd .c code::before{content:"$ ";color:var(--accent);font-weight:700}
.cmd .o{background:var(--term-bg);color:var(--term-fg);padding:12px 14px;margin:0;font:11.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;border-top:1px solid #1f2937}
/* Exit-status colour-coding: a non-zero command gets a red-tinted terminal and
   an "exit N" badge, so failures are spotted at a glance. */
.exit{flex:none;font:700 10.5px/1.6 ui-monospace,Menlo,monospace;padding:1px 8px;border-radius:999px;letter-spacing:.3px}
.exit.ok{color:#6ee7b7;background:rgba(110,231,183,.14)}
.exit.err{color:#fecaca;background:rgba(248,113,113,.2)}
.cmd.err{border-color:#b91c1c}
.cmd.err .c{background:#2a0e0e}
.cmd.err .o{background:#1a0a0a;border-top-color:#7f1d1d}
.cmd.err .c code::before{color:#f87171}
/* Each speaker is a card with a coloured left rail + matching eyebrow label. */
.msg{border-radius:10px;padding:14px 16px 14px 18px;margin:0 0 18px;background:var(--card);border:1px solid var(--border);border-left:4px solid var(--role,#cbd5e1)}
.msg .lbl{margin:0 0 9px;font-size:11px;letter-spacing:.6px;font-weight:800;text-transform:uppercase;display:flex;align-items:center;gap:8px;color:var(--role-fg,var(--muted))}
.msg .lbl::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--role,#cbd5e1);flex:none}
.msg.prompt{--role:var(--prompt);--role-fg:var(--prompt-fg);background:var(--prompt-bg);border-color:var(--prompt-bg);border-left-width:5px}
.msg.prompt .md{font-size:15.5px;line-height:1.6}
.msg.answer{--role:var(--answer);--role-fg:var(--answer-fg);background:var(--answer-bg);border-color:var(--answer-bg)}
.msg.agent{--role:var(--agent);--role-fg:var(--agent-fg);background:var(--agent-bg);border-color:var(--agent-bg)}
.turn-time{font-weight:600;letter-spacing:0;text-transform:none;color:var(--muted)}
.turn-time::before{content:"·";margin-right:8px;color:var(--muted)}
.md>:first-child{margin-top:0}.md>:last-child{margin-bottom:0}
.md p{margin:0 0 8px}
.md code{background:var(--code-bg);padding:1px 5px;border-radius:4px;font:12px ui-monospace,Menlo,monospace}
.md pre{background:var(--term-bg);color:var(--term-fg);padding:10px 12px;border-radius:8px;overflow:auto;margin:0 0 10px;font:11.5px/1.5 ui-monospace,Menlo,monospace}
.md pre code{background:none;padding:0;font-size:inherit;color:inherit}
.md table{border-collapse:collapse;margin:2px 0 10px;font-size:12.5px;display:block;overflow:auto}
.md th,.md td{border:1px solid var(--border);padding:4px 9px;text-align:left;vertical-align:top}
.md th{background:var(--th-bg);font-weight:700}
.md ul,.md ol{margin:2px 0 10px;padding-left:22px}.md li{margin:2px 0}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{font-size:13.5px;font-weight:700;margin:12px 0 6px}
.md blockquote{margin:0 0 10px;padding-left:12px;border-left:3px solid var(--border);color:var(--muted)}
.site-foot{max-width:1000px;margin:0 auto;padding:20px clamp(16px,4vw,32px) 40px;color:var(--muted);font-size:12px;border-top:1px solid var(--border)}
.site-foot .meta dt{color:var(--muted)}.site-foot .meta dd{color:var(--fg)}
.site-foot .meta{margin-top:0}
@media print{
  @page{margin:12mm 11mm}
  :root{--bg:#fff;--card:#fff}
  html,body{background:#fff;color:#000;font-size:10.5pt;line-height:1.5}
  /* Full-bleed to the page margin: drop the screen gutters and max-width. */
  .banner{background:#fff;color:#000;border-bottom:1pt solid #000;padding:0 0 8pt;margin-bottom:4pt}
  .banner h1{font-size:15pt;margin:0}
  .banner .sub{font-size:9pt;color:#333;max-width:none;margin-top:3pt}
  .scoreboard{gap:16pt;margin:8pt 0 0}.score{color:#333}.score b{color:#000}
  .meta{grid-template-columns:repeat(4,max-content);gap:3pt 18pt;margin-top:8pt;justify-content:start}
  .meta dt{color:#555;font-size:7.5pt}.meta dd{color:#000;font-size:9pt}
  .tabs{display:none}
  main{max-width:none;margin:0;padding:0}
  /* A flowing document — stages run on, separated by their heading rule, rather
     than one-per-page (which left half-empty pages). Only small units resist
     being split; headings stay with the content that follows them. */
  .stage-panel,.stage-panel[hidden]{display:block !important}
  .stage-panel+.stage-panel{margin-top:18pt}
  .stage-head{font-size:12.5pt;margin:0 0 9pt;padding-bottom:4pt;border-bottom:1pt solid #000;break-after:avoid}
  /* Strip the on-screen card chrome — borders, radius, fills and padding add
     clutter and eat width on paper. Speakers read from the labels instead. */
  .cfg{border:0;border-radius:0;margin:0 0 11pt;break-inside:auto}
  .cfg>summary{background:none;padding:0 0 5pt;gap:8px;border:0;break-after:avoid}
  .cfg .body{border:0;padding:0}
  .cfg-name{font-size:10.5pt}.why,.stat{font-size:8.5pt}
  /* Keep the speaker colour-coding on paper via a coloured left rail + dot +
     label (cheap ink, big readability win) but drop the boxy card fill/border. */
  .msg{border:0;border-left:3pt solid var(--role,#999);border-radius:0;background:none;padding:1pt 0 5pt 9pt;margin:0 0 11pt}
  .msg .lbl{font-size:8pt;margin-bottom:4pt}
  .msg.prompt .md{font-size:11.5pt}
  .cmd{border:0;margin:0 0 11pt;border-radius:0;overflow:visible}
  /* Never clip output on paper (the on-screen scroll cap must not truncate),
     and let long blocks split across pages so they fill the page rather than
     being pushed whole to the next one — which is what wasted the space. */
  .cmd .o,.md pre{max-height:none;overflow:visible}
  .cmd,.cmd .c,.cmd .o,.md pre,.md table,.msg{break-inside:auto}
  .site-foot{padding:10pt 0 0;margin-top:14pt;border-top:1pt solid #ccc;font-size:8pt}
  /* Keep a heading/label with what follows; everything else may split freely. */
  .stage-head,.cfg>summary,.msg .lbl{break-after:avoid}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`;

const JS = `(function(){
  "use strict";
  var active=${JSON.stringify(stages[0].id)};
  var tabs=Array.prototype.slice.call(document.querySelectorAll('[role=tab]'));
  window.show=function(n){
    active=n;
    document.querySelectorAll('[role=tabpanel]').forEach(function(p){p.hidden=(p.id!=='stage-'+n);});
    tabs.forEach(function(t){var on=t.id==='tab-'+n;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;});
  };
  // Roving-tabindex keyboard support on the tablist (WAI-ARIA Tabs pattern).
  var list=document.querySelector('[role=tablist]');
  if(list){list.addEventListener('keydown',function(e){
    var i=tabs.indexOf(document.activeElement);if(i<0)return;var j=i;
    if(e.key==='ArrowRight')j=(i+1)%tabs.length;
    else if(e.key==='ArrowLeft')j=(i-1+tabs.length)%tabs.length;
    else if(e.key==='Home')j=0;else if(e.key==='End')j=tabs.length-1;else return;
    e.preventDefault();var id=+tabs[j].id.replace('tab-','');window.show(id);tabs[j].focus();
  });}
  // Locale-aware durations (Intl.DurationFormat) and dates (Intl.DateTimeFormat),
  // formatted in the viewer's browser; server text is the no-JS fallback.
  function fmt(){
    var DF=(window.Intl&&Intl.DurationFormat)?new Intl.DurationFormat(undefined,{style:'narrow'}):null;
    document.querySelectorAll('.dur[data-ms]').forEach(function(el){
      var ms=+el.getAttribute('data-ms');if(!ms)return;var s=Math.round(ms/1000);
      var d={hours:Math.floor(s/3600),minutes:Math.floor((s%3600)/60),seconds:s%60};
      if(DF){try{el.textContent=DF.format(d);return;}catch(_){}}
    });
    var DT=window.Intl?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}):null;
    document.querySelectorAll('.ts[data-iso]').forEach(function(el){
      var d=new Date(el.getAttribute('data-iso'));if(isNaN(+d))return;
      el.textContent=DT?DT.format(d):d.toLocaleString();el.setAttribute('title',d.toISOString());
    });
  }
  window.addEventListener('DOMContentLoaded',function(){window.show(active);fmt();});
  // Save-as-PDF: lay every stage out linearly and open all sections (a collapsed
  // <details> or a hidden panel won't print), then restore the interactive view.
  window.addEventListener('beforeprint',function(){
    document.querySelectorAll('[role=tabpanel]').forEach(function(p){p.hidden=false;});
    document.querySelectorAll('details').forEach(function(d){d.dataset.wo=d.open?'1':'0';d.open=true;});
  });
  window.addEventListener('afterprint',function(){
    document.querySelectorAll('details').forEach(function(d){d.open=d.dataset.wo==='1';});
    window.show(active);
  });
})();`;

const subtitle = `One stateful run per config; the same project flows through ${stages.length} stages. Each stage shows the full conversation — the prompt, what the agent asked, what the user answered, and every command with its real output.`;

const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="cli-skill-e2e report">
<title>zitadel-cli journey eval</title>
<style>${CSS}</style>
</head>
<body>
<header class="banner">
  <h1>zitadel-cli skill — multi-stage journey eval</h1>
  <p class="sub">${esc(subtitle)}</p>
  <div class="scoreboard">${scoreboard}</div>
  ${metaDl()}
</header>
<nav class="tabs" role="tablist" aria-label="Journey stages">${tabs}</nav>
<main>${panels}</main>
<footer class="site-foot">
  <p>zitadel-cli agent-skill eval. The agent drives the CLI non-interactively; a simulated user answers its questions.</p>
  ${metaDl(`<div><dt>Node</dt><dd>${esc(meta.node)}</dd></div><div><dt>User model</dt><dd>${esc(meta.simModel)}</dd></div>`)}
</footer>
<script>${JS}</script>
</body>
</html>`;

const dest = join(OUT, "journey.html");
writeFileSync(dest, doc);
console.log("report:", dest);
