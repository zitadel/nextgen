// In-page review widget for the docs-review skill. Served by server.mjs, which
// replaces __ZRN_ENDPOINT__ with the server's URL. See ../SKILL.md.
(() => {
  const API = "__ZRN_ENDPOINT__";
  const OUTBOX = "zitadel-docs-review-outbox:v1";
  if (window.__zrn) {
    window.__zrn.toggle(true);
    return "already injected";
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const htext = (h) =>
    h.innerText
      .replace(/Copy Anchor Link/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);

  // Server state. The cache is updated optimistically; the outbox holds
  // {opId, op, id, body} until the server has acknowledged it.
  let notes = [];
  let lastJson = "";
  let connected = false;
  let flushing = null;
  let notice = "";
  const loadOutbox = () => {
    try {
      return JSON.parse(localStorage.getItem(OUTBOX) || "[]");
    } catch (_e) {
      return [];
    }
  };
  const saveOutbox = (q) => {
    try {
      localStorage.setItem(OUTBOX, JSON.stringify(q));
    } catch (e) {
      console.warn("zrn outbox save failed", e);
    }
  };
  const request = (method, path, body) =>
    fetch(API + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  const setConnected = (on) => {
    connected = on;
    renderDot();
  };
  const dropOp = (opId) => saveOutbox(loadOutbox().filter((q) => q.opId !== opId));
  const setNotice = (text) => {
    notice = text;
    renderDot();
  };
  // Re-reads the outbox on every turn: `send` may append while a request is
  // in flight, and another tab may share the key.
  const flush = () => {
    if (flushing) return flushing;
    flushing = (async () => {
      let changed = false;
      for (;;) {
        const queue = loadOutbox();
        if (!queue.length) break;
        const { opId, op, id, body } = queue[0];
        let r;
        try {
          if (op === "add") r = await request("POST", "/notes", body);
          else if (op === "update")
            r = await request("PATCH", `/notes/${encodeURIComponent(id)}`, body);
          else if (op === "delete") r = await request("DELETE", `/notes/${encodeURIComponent(id)}`);
        } catch (_e) {
          setConnected(false);
          return false;
        }
        if (r && !r.ok && r.status >= 500) {
          setConnected(false);
          return false;
        }
        if (r && !r.ok) {
          console.warn(`zrn ${op} ${id} rejected with ${r.status}`, body);
          setNotice(`${op} of note ${id} rejected (${r.status})`);
        }
        dropOp(opId);
        changed = true;
      }
      if (changed) lastJson = "";
      return true;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  };
  const pull = async () => {
    try {
      const r = await request("GET", "/notes");
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      setConnected(loadOutbox().length === 0);
      const json = JSON.stringify(data);
      if (json === lastJson) return;
      lastJson = json;
      notes = data;
      render();
    } catch (_e) {
      setConnected(false);
    }
  };
  const sync = async () => {
    if (await flush()) await pull();
  };
  const send = (op, id, body) => {
    saveOutbox([...loadOutbox(), { opId: uid(), op, id, body }]);
    renderDot();
    sync();
  };

  const host = document.createElement("div");
  host.id = "zrn-host";
  host.style.cssText =
    "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;";
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
:host{--bg:#fff;--fg:#1a1a1a;--mut:#666;--bd:#d9d9de;--acc:#5b5bd6;--soft:#f3f3f7;--ok:#2fa84f;--err:#d1434b}
@media (prefers-color-scheme:dark){:host{--bg:#1c1c21;--fg:#ececf1;--mut:#a0a0ab;--bd:#3a3a44;--acc:#8b8bf0;--soft:#26262d;--ok:#4cc46a;--err:#f07178}}
[hidden]{display:none!important}
*{box-sizing:border-box;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--fg)}
button{cursor:pointer;border:1px solid var(--bd);background:var(--bg);border-radius:6px;padding:4px 8px}
button:hover{border-color:var(--acc)}
.primary{background:var(--acc);border-color:var(--acc);color:#fff}
.fab{position:fixed;right:16px;bottom:16px;padding:8px 12px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.2);font-weight:600}
.sel{position:fixed;padding:4px 10px;box-shadow:0 2px 8px rgba(0,0,0,.25);background:var(--acc);color:#fff;border-color:var(--acc);font-weight:600}
.panel{position:fixed;right:16px;bottom:60px;width:420px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--bd);border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,.25);overflow:hidden}
header{display:flex;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--bd);background:var(--soft)}
header label{display:flex;gap:4px;align-items:center;color:var(--mut)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--mut);display:inline-block;flex:none}
.dot.on{background:var(--ok)}
.dot.err{background:var(--err)}
.notice{padding:4px 10px;font-size:12px;color:var(--err);border-bottom:1px solid var(--bd);display:flex;gap:6px;align-items:center}
.notice button{font-size:11px;padding:0 6px}
.sp{flex:1}
.composer{padding:10px;border-bottom:1px solid var(--bd);display:flex;flex-direction:column;gap:6px;flex:none}
.ctx{color:var(--mut);font-size:12px}
.ctx blockquote,li blockquote{margin:4px 0;padding:2px 8px;border-left:3px solid var(--acc);color:var(--mut);max-height:4.2em;overflow:hidden;white-space:pre-wrap}
textarea{width:100%;min-height:80px;resize:vertical;border:1px solid var(--bd);border-radius:6px;padding:6px;background:var(--bg)}
textarea:focus{outline:2px solid var(--acc);outline-offset:-1px}
select{border:1px solid var(--bd);border-radius:6px;background:var(--bg);padding:3px}
.row{display:flex;gap:6px;align-items:center}
ol{list-style:none;margin:0;padding:0;overflow:auto;min-height:0}
li{padding:8px 10px;border-bottom:1px solid var(--bd)}
li .meta{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--mut)}
li .meta a{color:var(--acc);text-decoration:none;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li .agent{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--mut);margin-top:4px}
li .agent code{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg)}
li .agent a{color:var(--acc);text-decoration:none}
.badge{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--soft);border:1px solid var(--bd)}
.badge.st-mapped{border-color:var(--acc);color:var(--acc)}
.badge.st-drafted,.badge.st-filed{border-color:var(--ok);color:var(--ok)}
li .c{white-space:pre-wrap;margin-top:2px}
li .act{white-space:nowrap}
li .act button{font-size:11px;padding:1px 6px}
.empty{padding:14px;color:var(--mut);text-align:center}
.editing{outline:2px solid var(--acc);outline-offset:-2px}
</style>
<button class="fab" id="fab" title="Review notes (Alt+N to add)">Notes <span id="count"></span></button>
<button class="sel" id="sel" hidden>+ Comment</button>
<div class="panel" id="panel" hidden>
 <header><span class="dot" id="dot" title="offline"></span><strong>Review notes</strong><span class="sp"></span><label><input type="checkbox" id="all"> all pages</label><button id="copy">Copy MD</button><button id="close" title="Close">×</button></header>
 <div class="notice" id="notice" hidden><span id="noticetext"></span><span class="sp"></span><button id="noticeclose" title="Dismiss">×</button></div>
 <div class="composer">
  <div class="ctx" id="ctx"></div>
  <textarea id="ta" placeholder="Comment… (Ctrl/Cmd+Enter to save, Esc to close)"></textarea>
  <div class="row"><select id="kind"><option value="bug">bug</option><option value="content">content</option><option value="question">question</option><option value="nit">nit</option><option value="idea">idea</option></select><span class="sp"></span><button id="clearq">Drop quote</button><button id="saveb" class="primary">Save</button></div>
 </div>
 <ol id="list"></ol>
</div>`;
  const $ = (id) => root.getElementById(id);
  const panel = $("panel");
  const ta = $("ta");
  const selBtn = $("sel");
  let draft = null;
  let editingId = null;
  let selCache = null;
  let lastPath = location.pathname;

  const anchorOf = (h) =>
    h.id ||
    h.querySelector("[id]")?.id ||
    (h.querySelector('a[href^="#"]')?.getAttribute("href") || "").slice(1) ||
    "";
  const ctxFor = (node) => {
    const trail = {};
    for (const h of document.querySelectorAll("h1,h2,h3,h4,h5")) {
      if (
        node &&
        (h === node ||
          h.contains(node) ||
          h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
      ) {
        const lvl = +h.tagName[1];
        trail[lvl] = { text: htext(h), anchor: anchorOf(h) };
        for (let l = lvl + 1; l <= 6; l++) delete trail[l];
      } else break;
    }
    const levels = Object.keys(trail).sort();
    const section = levels.map((l) => trail[l].text).join(" › ");
    const anchor =
      [...levels]
        .reverse()
        .map((l) => trail[l].anchor)
        .find(Boolean) || "";
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const elemId = el?.closest("[id]:not(#__next):not(body):not(html)")?.id || "";
    return { section, anchor, elemId };
  };
  const viewportNode = () => {
    let best = null;
    for (const h of document.querySelectorAll("h1,h2,h3,h4,h5")) {
      if (h.getBoundingClientRect().top < 160) best = h;
      else break;
    }
    return best || document.querySelector("h1");
  };
  const renderCtx = () => {
    if (!draft) {
      $("ctx").innerHTML = "";
      return;
    }
    $("ctx").innerHTML =
      `<div>${editingId ? "<b>Editing</b> · " : ""}${esc(draft.section || document.title)}${
        draft.anchor ? ` <span class="badge">#${esc(draft.anchor)}</span>` : ""
      }</div>${draft.quote ? `<blockquote>${esc(draft.quote)}</blockquote>` : ""}`;
    $("clearq").hidden = !draft.quote;
  };
  const toggle = (force) => {
    panel.hidden = force === undefined ? !panel.hidden : !force;
    if (!panel.hidden) {
      if (!draft) draft = { quote: "", ...ctxFor(viewportNode()) };
      renderCtx();
      render();
      sync();
    }
  };
  const openComposer = (quote, node) => {
    editingId = null;
    draft = { quote: quote || "", ...ctxFor(node || viewportNode()) };
    ta.value = "";
    toggle(true);
    renderCtx();
    setTimeout(() => ta.focus(), 0);
  };
  const saveNote = () => {
    const comment = ta.value.trim();
    if (!comment) {
      ta.focus();
      return;
    }
    const now = new Date().toISOString();
    // A note edited after it was removed elsewhere is saved as a new one.
    const editing = editingId ? notes.find((x) => x.id === editingId) : null;
    if (editing) {
      const patch = {
        comment,
        kind: $("kind").value,
        quote: draft?.quote ?? editing.quote,
        updatedAt: now,
      };
      Object.assign(editing, patch);
      send("update", editing.id, patch);
    } else {
      const base = location.origin + location.pathname;
      const note = {
        id: uid(),
        kind: $("kind").value,
        comment,
        quote: draft?.quote || "",
        page: document.title,
        path: location.pathname,
        url: base + (draft?.anchor ? `#${draft.anchor}` : location.hash),
        section: draft?.section || "",
        anchor: draft?.anchor || "",
        elemId: draft?.elemId || "",
        status: "new",
        createdAt: now,
      };
      notes.push(note);
      send("add", note.id, note);
    }
    editingId = null;
    ta.value = "";
    draft = { quote: "", ...ctxFor(viewportNode()) };
    renderCtx();
    render();
  };
  const webUrl = (s) => {
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:" ? u : null;
    } catch (_e) {
      return null;
    }
  };
  const issueHtml = (issue) => {
    const u = webUrl(issue);
    if (!u) return `<span>${esc(issue)}</span>`;
    const m = u.pathname.match(/\/(\d+)\/?$/);
    return `<a href="${esc(u.href)}" target="_blank" rel="noopener">${m ? `#${m[1]}` : "issue"}</a>`;
  };
  const renderDot = () => {
    const on = connected && loadOutbox().length === 0;
    $("dot").className = notice ? "dot err" : on ? "dot on" : "dot";
    $("dot").title = notice ? notice : on ? "connected" : connected ? "queued" : "offline";
    $("notice").hidden = !notice;
    $("noticetext").textContent = notice;
  };
  const render = () => {
    $("count").textContent = notes.length ? `(${notes.length})` : "";
    renderDot();
    if (panel.hidden) return;
    if (root.activeElement === ta) return;
    const all = $("all").checked;
    const shown = notes.filter((n) => all || n.path === location.pathname).reverse();
    $("list").innerHTML = shown.length
      ? shown
          .map(
            (n) => `<li data-id="${esc(n.id)}" class="${n.id === editingId ? "editing" : ""}">
    <div class="meta"><span class="badge">${esc(n.kind)}</span><a data-go="${esc(n.url)}" title="${esc(n.url)}">${esc((all ? `${n.page} · ` : "") + (n.section || n.page))}</a><span class="sp"></span>
    <span class="act"><button type="button" data-edit>edit</button> <button type="button" data-del>del</button></span></div>
    ${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ""}<div class="c">${esc(n.comment)}</div>
    <div class="agent"><span class="badge st-${esc(n.status || "new")}">${esc(n.status || "new")}</span>${
      n.source ? `<code title="${esc(n.sourceKind || "")}">${esc(n.source)}</code>` : ""
    }${n.issue ? issueHtml(n.issue) : ""}</div></li>`,
          )
          .join("")
      : `<div class="empty">No notes ${all ? "yet" : "on this page"}. Select text and click “+ Comment”, or press Alt+N.</div>`;
  };
  $("list").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest("[data-del]")) {
      if (confirm("Delete this note?")) {
        notes = notes.filter((n) => n.id !== id);
        if (editingId === id) editingId = null;
        send("delete", id);
        render();
      }
      return;
    }
    if (e.target.closest("[data-edit]")) {
      const n = notes.find((x) => x.id === id);
      if (!n) return;
      editingId = id;
      draft = { quote: n.quote, section: n.section, anchor: n.anchor };
      ta.value = n.comment;
      $("kind").value = n.kind;
      renderCtx();
      render();
      ta.focus();
      return;
    }
    const go = e.target.closest("[data-go]");
    if (go) {
      const u = webUrl(go.dataset.go);
      if (!u) return;
      if (u.pathname === location.pathname) {
        const t = u.hash && document.getElementById(decodeURIComponent(u.hash.slice(1)));
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      } else location.href = u.href;
    }
  });
  const toMarkdown = () => {
    const byPage = {};
    for (const n of notes) {
      byPage[n.path] ||= [];
      byPage[n.path].push(n);
    }
    return Object.entries(byPage)
      .map(
        ([p, ns]) =>
          `## ${ns[0].page} (${p})\n\n${ns
            .map(
              (n) =>
                `- **[${n.kind}]** ${n.section ? `_${n.section}_ ` : ""}([link](${n.url}))\n${
                  n.quote ? `  > ${n.quote.replace(/\n/g, "\n  > ")}\n` : ""
                }  ${n.comment.replace(/\n/g, "\n  ")}`,
            )
            .join("\n")}`,
      )
      .join("\n\n");
  };
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown());
      $("copy").textContent = "Copied";
    } catch (_e) {
      $("copy").textContent = "Failed";
    }
    setTimeout(() => {
      $("copy").textContent = "Copy MD";
    }, 1500);
  };
  $("noticeclose").onclick = () => setNotice("");
  $("fab").onclick = () => toggle();
  $("close").onclick = () => toggle(false);
  $("all").onchange = render;
  $("saveb").onclick = saveNote;
  $("clearq").onclick = () => {
    if (draft) draft.quote = "";
    renderCtx();
  };
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveNote();
    }
    if (e.key === "Escape") toggle(false);
    e.stopPropagation();
  });
  ta.addEventListener("keyup", (e) => e.stopPropagation());
  ta.addEventListener("keypress", (e) => e.stopPropagation());
  // The textarea blocks list re-renders while focused; catch up on blur.
  ta.addEventListener("blur", () => setTimeout(render, 0));

  document.addEventListener(
    "mouseup",
    (e) => {
      if (e.composedPath().includes(host)) return;
      setTimeout(() => {
        const s = getSelection();
        const t = s && !s.isCollapsed ? s.toString().trim() : "";
        if (!t) {
          selBtn.hidden = true;
          return;
        }
        const range = s.getRangeAt(0);
        const r = range.getBoundingClientRect();
        selCache = { quote: t.slice(0, 1500), node: range.startContainer };
        selBtn.style.top = `${Math.max(8, r.top - 34)}px`;
        selBtn.style.left = `${Math.max(8, Math.min(innerWidth - 120, r.left + r.width / 2 - 45))}px`;
        selBtn.hidden = false;
      }, 10);
    },
    true,
  );
  selBtn.addEventListener("mousedown", (e) => e.preventDefault());
  selBtn.onclick = () => {
    selBtn.hidden = true;
    if (selCache) openComposer(selCache.quote, selCache.node);
  };
  window.addEventListener(
    "scroll",
    () => {
      selBtn.hidden = true;
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.altKey && e.code === "KeyN") {
        e.preventDefault();
        const s = getSelection();
        const t = s && !s.isCollapsed ? s.toString().trim() : "";
        openComposer(t.slice(0, 1500), t ? s.getRangeAt(0).startContainer : null);
      }
    },
    true,
  );
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      selBtn.hidden = true;
      if (!editingId) draft = null;
      render();
      if (!panel.hidden) toggle(true);
    }
  }, 800);
  setInterval(() => {
    if (!panel.hidden) sync();
  }, 3000);

  window.__zrn = {
    toggle,
    notes: () => notes,
    markdown: toMarkdown,
    sync,
    api: API,
    outbox: OUTBOX,
  };
  render();
  sync();
  return "injected";
})();
