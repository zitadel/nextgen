/** The report's stylesheet: light and dark, a print layout, and the speaker colour-coding. */
export const REPORT_CSS = `
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
.metrics-wrap{padding:20px clamp(16px,4vw,32px) 0}
.metrics{border-collapse:collapse;width:100%;font-size:13px;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.metrics th,.metrics td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
.metrics thead th{background:var(--th-bg);font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
.metrics tbody th{font-weight:700}
.metrics td.sr{text-align:center;font-variant-numeric:tabular-nums;font-weight:700}
.metrics td.sr.ok{color:#16a34a}.metrics td.sr.mid{color:#d97706}.metrics td.sr.no{color:#dc2626}
.metrics .muted{color:var(--muted);font-weight:400}
.metrics-note{font-size:11.5px;color:var(--muted);margin:8px 2px 0;white-space:normal}
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
.took{flex:none;font:600 10.5px/1.6 ui-monospace,Menlo,monospace;color:#fcd34d;white-space:nowrap}
.took.think{color:#94a3b8;font-weight:500}
.timing{margin:0 0 20px;border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--card)}
.timing-h{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:0 0 8px}
.timing-h+.slow,.legend+.timing-h{margin-top:12px}
.bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--border);margin:0 0 10px}
.seg.run,.sw.run{background:#f59e0b}.seg.model,.sw.model{background:#6366f1}.seg.start,.sw.start{background:#94a3b8}.seg.wait,.sw.wait{background:#2dd4bf}
.legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px}
.legend .sw{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
.legend .muted{color:var(--muted)}
.slow{margin:0;padding-left:20px;font-size:12.5px}.slow code{font:11.5px ui-monospace,Menlo,monospace;color:var(--muted)}
.exit{flex:none;font:700 10.5px/1.6 ui-monospace,Menlo,monospace;padding:1px 8px;border-radius:999px;letter-spacing:.3px}
.exit.ok{color:#6ee7b7;background:rgba(110,231,183,.14)}
.exit.err{color:#fecaca;background:rgba(248,113,113,.2)}
.exit.unk{color:#cbd5e1;background:rgba(203,213,225,.16)}
.cmd.file .c code::before{content:"✎ ";color:var(--accent);font-weight:700}
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
