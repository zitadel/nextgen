(() => {
  "use strict";

  const viewEl = () => document.getElementById("view");
  const flashEl = () => document.getElementById("flash");
  const requestLogEl = () => document.getElementById("request-log");
  const requestsPanel = () => document.getElementById("requests-panel");

  let lastTimeline = null;
  let flash = { ok: "", err: "" };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setFlash(ok, err) {
    flash = { ok: ok || "", err: err || "" };
    const el = flashEl();
    if (!el) return;
    el.innerHTML = "";
    if (flash.ok) el.innerHTML += `<div class="flash-ok">${esc(flash.ok)}</div>`;
    if (flash.err) el.innerHTML += `<div class="flash-err">${esc(flash.err)}</div>`;
  }

  function appendRequestLog(entry) {
    const ol = requestLogEl();
    if (!ol) return;
    const li = document.createElement("li");
    const cls = entry.status >= 200 && entry.status < 400 ? "ok" : "err";
    li.innerHTML = `<span class="method">${esc(entry.method)}</span>` +
      `<code>${esc(entry.path)}</code> · ` +
      `<span class="${cls}">${entry.status}</span> · ${entry.ms} ms`;
    ol.prepend(li);
    while (ol.children.length > 80) ol.removeChild(ol.lastChild);
  }

  async function api(method, path, body) {
    const started = performance.now();
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let status = 0;
    let data = null;
    try {
      const res = await fetch(path, opts);
      status = res.status;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!res.ok) {
        const err = new Error((data && data.error) || res.statusText || "request failed");
        err.status = status;
        err.data = data;
        throw err;
      }
      return data;
    } finally {
      appendRequestLog({
        method,
        path,
        status: status || 0,
        ms: Math.round(performance.now() - started),
      });
    }
  }

  function setNav(active) {
    document.querySelectorAll(".sidebar a[data-nav]").forEach((a) => {
      a.classList.toggle("active", a.dataset.nav === active);
    });
  }

  function crumbs(items) {
    if (!items || !items.length) return "";
    return `<nav class="breadcrumbs">${items.map((c, i) => {
      const sep = i ? `<span class="sep">/</span>` : "";
      if (c.href) return `${sep}<a href="${esc(c.href)}" data-link>${esc(c.label)}</a>`;
      return `${sep}<span>${esc(c.label)}</span>`;
    }).join("")}</nav>`;
  }

  function renderTimeline(tl) {
    if (!tl) return "";
    lastTimeline = tl;
    const steps = tl.steps || [];
    let stepsHtml = "";
    if (steps.length) {
      stepsHtml = `<ol class="hop-tl" aria-label="Call timeline">${steps.map((s) => {
        const hit = s.is_hit ? " hop-step-hit" : "";
        const dotHit = s.is_hit ? " hop-dot-hit" : "";
        const parent = s.parent ? `<details class="hop-more"><summary>Parent resolve</summary>
          <p><span class="hop-actor hop-ui">${esc(s.parent.caller)}</span> →
          <span class="hop-actor hop-cell">${esc(s.parent.cell_label)}</span> ·
          <code>${esc(s.parent.method)}</code> · ${esc(s.parent.result)} · ${s.parent.ms} ms · ${esc(s.parent.next_hint)}</p>
        </details>` : "";
        const pair = s.pair_delay_ms > 0 && s.pair_hint !== "entry"
          ? `<strong>${s.pair_delay_ms} ms</strong> (${esc(s.pair_hint)})`
          : `${s.pair_delay_ms} ms (${esc(s.pair_hint)})`;
        return `<li class="hop-step${hit}">
          <div class="hop-rail" aria-hidden="true"><span class="hop-dot${dotHit}"></span></div>
          <div class="hop-card">
            <div class="hop-step-meta">
              <span class="hop-n">${s.n}</span>
              <span class="hop-when">t+${s.cumulative_ms} ms</span>
              <span class="hop-badge ${esc(s.result_class)}">${esc(s.result)}</span>
            </div>
            <p class="hop-call">
              <span class="hop-actor hop-ui">${esc(s.caller)}</span>
              <span class="hop-arrow" aria-hidden="true">→</span>
              <span class="hop-actor hop-cell">${esc(s.cell_label)}</span>
            </p>
            <p class="hop-ep"><code>${esc(s.method)}</code>${s.project_id ? ` · project <code>${esc(s.project_id)}</code>` : ""}${s.home_hint ? ` · home=<code>${esc(s.home_hint)}</code>` : ""}</p>
            <p class="hop-timing">wire ${s.wire_ms} ms · pair delay ${pair} · step ${s.step_ms} ms</p>
            ${parent}
          </div>
        </li>`;
      }).join("")}</ol>`;
      const lanes = (tl.swimlanes || []).map((l) => {
        const barCls = `hop-lane-bar${l.delay_ms > 0 ? " hop-lane-bar-d" : ""}${l.is_hit ? " hop-lane-bar-hit" : ""}`;
        return `<div class="hop-lane">
          <span class="hop-lane-lab">${esc(l.label)}</span>
          <span class="${barCls}" style="--d:${l.delay_ms}"></span>
          <span class="hop-lane-val">${l.delay_ms} ms · ${esc(l.result)}</span>
        </div>`;
      }).join("");
      stepsHtml += lanes
        ? `<div class="hop-swim" aria-label="Cell swimlane summary">
            <p class="hop-swim-title">Who was called</p>
            <div class="hop-lanes">${lanes}</div>
          </div>`
        : "";
    } else {
      stepsHtml = `<p class="muted">No peer hops recorded for this action.</p>`;
    }
    const when = tl.at_short || tl.at || "";
    const total = steps.length
      ? `<p class="hop-total">Total <strong>${tl.total_ms} ms</strong> · ${tl.step_count} site step${tl.step_count === 1 ? "" : "s"}${tl.outcome ? ` · ${esc(tl.outcome)}` : ""}</p>`
      : "";
    return `<div class="panel latest-trace hop-frame" role="region" aria-label="Latest hop timeline">
      <header class="hop-head">
        <div>
          <h2 class="hop-title">Latest hop</h2>
          <p class="hop-sub">${esc(when)} · <strong>${esc(tl.action)}</strong>${tl.note ? ` — ${esc(tl.note)}` : ""}</p>
        </div>
        ${total}
      </header>
      ${stepsHtml}
    </div>`;
  }

  function timelineFrom(payload) {
    if (!payload) return lastTimeline;
    if (payload.timeline) return payload.timeline;
    if (payload.latest && payload.latest.timeline) return payload.latest.timeline;
    return lastTimeline;
  }

  function renderNode(n) {
    const reachable = n.reachable;
    const alive = n.alive;
    let dot = "down";
    if (reachable && alive) dot = "";
    else if (reachable) dot = "stale";
    const kids = (n.children || []).map(renderNode).join("");
    return `<li class="node">
      <span class="dot${dot ? " " + dot : ""}"></span>
      <a href="/cells/${encodeURIComponent(n.label)}" data-link style="color:inherit;text-decoration:none;font-weight:600">${esc(n.label)}</a>
      ${n.is_parent ? `<span class="badge parent">parent</span>` : ""}
      <span class="badge">${esc(n.status)}</span>
      <div><code>${esc(n.url)}</code></div>
      ${n.error ? `<div class="muted">${esc(n.error)}</div>` : ""}
      ${kids ? `<ul class="tree">${kids}</ul>` : ""}
    </li>`;
  }

  async function pageCells() {
    setNav("cells");
    document.title = "Cells · cell hierarchy";
    const data = await api("GET", "/api/v1/cells");
    lastTimeline = timelineFrom(data);
    const tree = (data.tree || []).map(renderNode).join("");
    const unjoined = (data.unjoined || []).map(renderNode).join("");
    const parents = (data.parents || []).map((p) =>
      `<option value="${esc(p.url)}">${esc(p.label)} — ${esc(p.url)}</option>`).join("");
    const unjoinedOpts = (data.unjoined_opts || []).map((p) =>
      `<option value="${esc(p.url)}">${esc(p.label)} — ${esc(p.url)}</option>`).join("");
    const delays = (data.delay_pairs || []).map((d) =>
      `<tr><td><code>${esc(d.left)}</code> ↔ <code>${esc(d.right)}</code></td><td>${d.ms}</td></tr>`).join("");
    viewEl().innerHTML = `
      <h1>Cells</h1>
      <p class="muted">Ops surface: topology + join spare. All browser traffic stays on this UI origin (<code>/api/v1/*</code>); cell↔cell hops stay server-side.</p>
      <div class="panel" style="margin-bottom:1rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
        <button type="button" id="refresh-cells">Refresh tree</button>
        <span class="muted">Platform-only · no auto-poll</span>
      </div>
      <div class="panel">
        <h2>Cell tree</h2>
        <div class="muted">Updated ${esc(data.now)} · from platform GetMe + children only</div>
        ${tree ? `<ul class="tree root">${tree}</ul>` : `<p class="muted">No rooted cells reachable.</p>`}
        <h2 style="margin-top:1rem">Unjoined</h2>
        ${unjoined ? `<ul class="tree root">${unjoined}</ul>` : `<p class="muted">None</p>`}
      </div>
      <div class="panel">
        <h2>Join spare</h2>
        <p class="muted">Prepare an invite on a parent cell, then accept on an unjoined child.</p>
        <form id="join-form">
          <label for="parent_url">Parent (is_parent)</label>
          <select id="parent_url" name="parent_url" required>
            <option value="">Select parent…</option>${parents}
          </select>
          <label for="child_url">Unjoined cell</label>
          <select id="child_url" name="child_url" required>
            <option value="">Select cell…</option>${unjoinedOpts}
          </select>
          <button type="submit">Join</button>
        </form>
      </div>
      <div class="panel">
        <h2>Pairwise delays (fixed)</h2>
        <p class="muted">Read-only defaults. Same-cell = 0; unlisted labeled pairs = 0; unlabeled URLs = 50ms.</p>
        <table class="delay-matrix">
          <thead><tr><th>Pair</th><th>Delay (ms)</th></tr></thead>
          <tbody>${delays}</tbody>
        </table>
      </div>
      ${renderTimeline(lastTimeline)}
    `;
    document.getElementById("refresh-cells").onclick = () => route();
    document.getElementById("join-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await api("POST", "/api/v1/join", {
          parent_url: fd.get("parent_url"),
          child_url: fd.get("child_url"),
        });
        lastTimeline = res.timeline || lastTimeline;
        setFlash(res.ok, "");
        await pageCells();
      } catch (err) {
        lastTimeline = err.data && err.data.timeline || lastTimeline;
        setFlash("", err.message);
        await pageCells();
      }
    };
  }

  async function pageCell(label) {
    setNav("cells");
    document.title = `Cell ${label} · cell hierarchy`;
    const data = await api("GET", `/api/v1/cells/${encodeURIComponent(label)}`);
    lastTimeline = timelineFrom(data);
    const me = data.me || {};
    const children = (data.children || []).map((c) =>
      `<tr><td>${esc(c.label)}</td><td><code>${esc(c.child_url)}</code></td>
       <td>${c.alive ? "yes" : "no"}</td><td class="muted">${esc(c.last_seen_at || "")}</td></tr>`).join("");
    const projects = (data.projects || []).map((p) =>
      `<tr><td><a href="/projects/${encodeURIComponent(p.id)}" data-link><code>${esc(p.id)}</code></a></td>
       <td>${esc(p.name)}</td><td class="muted">${esc(p.workspace_id || "")}</td>
       <td>${p.lookup_enabled ? "on" : "off"}</td></tr>`).join("");
    viewEl().innerHTML = `
      ${crumbs([{ label: "Cells", href: "/" }, { label: label }])}
      <h1>Cell ${esc(label)}</h1>
      ${data.error ? `<div class="flash-err">${esc(data.error)}</div>` : ""}
      <div class="panel">
        <h2>Me</h2>
        <p><code>${esc(me.label || label)}</code>${me.display ? ` · ${esc(me.display)}` : ""}</p>
        <p class="muted">${esc(me.url || data.url || "")} · status=${esc(me.status || "")}
          ${me.is_parent ? "· parent" : ""}${me.parent_url ? ` · parent_url=${esc(me.parent_url)}` : ""}</p>
      </div>
      <div class="panel">
        <h2>Children</h2>
        ${children ? `<table><thead><tr><th>Label</th><th>URL</th><th>Alive</th><th>Last seen</th></tr></thead><tbody>${children}</tbody></table>` : `<p class="muted">No children.</p>`}
      </div>
      <div class="panel">
        <h2>Projects</h2>
        ${projects ? `<table><thead><tr><th>ID</th><th>Name</th><th>Workspace</th><th>Lookup</th></tr></thead><tbody>${projects}</tbody></table>` : `<p class="muted">No projects.</p>`}
      </div>
      ${renderTimeline(lastTimeline)}
    `;
  }

  async function pagePlatform() {
    setNav("platform");
    document.title = "Platform · cell hierarchy";
    const data = await api("GET", "/api/v1/platform");
    lastTimeline = timelineFrom(data);
    const proj = data.project;
    const teams = (data.teams || []).map((t) =>
      `<tr><td><code>${esc(t.id)}</code></td><td>${esc(t.name)}</td><td class="muted">${esc(t.created_at || "")}</td></tr>`).join("");
    viewEl().innerHTML = `
      ${crumbs([{ label: "Platform" }])}
      <h1>Platform</h1>
      <p class="muted">Hoster surface: platform project + customer teams. Browser calls UI JSON only.</p>
      ${data.error ? `<p class="flash-err">${esc(data.error)}</p>` : ""}
      <div class="panel">
        <h2>Platform project</h2>
        ${proj ? `<p><a href="/projects/platform" data-link><code>${esc(proj.id)}</code></a>
          ${proj.lookup_enabled ? `<span class="badge lookup">lookup on</span>` : ""}
          ${proj.is_parent ? `<span class="badge parent">parent</span>` : ""}</p>
          <p class="muted">host=${esc(data.host_url || "")}</p>` : `<p class="muted">Platform project not found — run bootstrap.</p>`}
      </div>
      <div class="panel">
        <h2>Customer teams</h2>
        ${teams ? `<table><thead><tr><th>ID</th><th>Name</th><th>Created</th></tr></thead><tbody>${teams}</tbody></table>` : `<p class="muted">No teams yet.</p>`}
        <h2 style="margin-top:1rem">Create team</h2>
        <form id="team-form">
          <label for="team_name">Customer name</label>
          <input id="team_name" name="name" required placeholder="acme"/>
          <label for="team_id">Team id (optional)</label>
          <input id="team_id" name="id" placeholder="acme"/>
          <button type="submit">Create team</button>
        </form>
      </div>
      ${renderTimeline(lastTimeline)}
    `;
    document.getElementById("team-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await api("POST", "/api/v1/platform/teams", {
          name: fd.get("name"), id: fd.get("id") || undefined,
        });
        lastTimeline = res.timeline || lastTimeline;
        setFlash(res.ok, "");
        await pagePlatform();
      } catch (err) {
        lastTimeline = err.data && err.data.timeline || lastTimeline;
        setFlash("", err.message);
        await pagePlatform();
      }
    };
  }

  async function pageWorkspaces() {
    setNav("workspaces");
    document.title = "Workspaces · cell hierarchy";
    const data = await api("GET", "/api/v1/workspaces");
    lastTimeline = timelineFrom(data);
    const sites = (data.sites || []).map((s) =>
      `<tr>
        <td><a href="/projects/${encodeURIComponent(s.id)}" data-link><code>${esc(s.id)}</code></a> ${esc(s.name)}</td>
        <td>${esc(s.host_label)}</td>
        <td class="muted">${esc(s.customer_team_id || "")}</td>
        <td>${s.user_count}</td>
        <td>${s.lookup_enabled ? `<span class="badge lookup">on</span>` : "off"}</td>
      </tr>`).join("");
    const cells = (data.cells || []).map((c) =>
      `<option value="${esc(c.label)}"${c.label === "eu-1" ? " selected" : ""}>${esc(c.label)}</option>`).join("");
    const teams = (data.teams || []).map((t) =>
      `<option value="${esc(t.id)}">${esc(t.name)} (<code>${esc(t.id)}</code>)</option>`).join("");
    viewEl().innerHTML = `
      ${crumbs([{ label: "Workspaces" }])}
      <h1>Workspaces</h1>
      <p class="muted">A workspace is the customer's first site on a chosen cell, linked to a platform team.</p>
      <div class="panel">
        <h2>Root sites</h2>
        ${sites ? `<table><thead><tr><th>Workspace / site</th><th>Cell</th><th>Team</th><th>Users</th><th>Lookup</th></tr></thead><tbody>${sites}</tbody></table>`
          : `<p class="muted">No workspaces yet. Create a platform team first, then a workspace here.</p>`}
      </div>
      <div class="panel">
        <h2>Create workspace (= first site)</h2>
        <p class="muted">Creates the project on the chosen cell with lookup enabled and empty parent (site-only chain).</p>
        ${teams ? `<form id="ws-form">
          <label for="ws_id">Workspace / site id</label>
          <input id="ws_id" name="id" required placeholder="acme"/>
          <label for="ws_name">Name</label>
          <input id="ws_name" name="name" placeholder="Acme"/>
          <label for="ws_cell">Cell</label>
          <select id="ws_cell" name="cell" required>${cells}</select>
          <label for="ws_team">Customer team (on platform)</label>
          <select id="ws_team" name="customer_team_id" required>
            <option value="">Select team…</option>${teams}
          </select>
          <button type="submit">Create workspace</button>
        </form>` : `<p class="flash-err">No teams on platform yet. <a href="/platform" data-link>Create a team</a> first.</p>`}
      </div>
      ${renderTimeline(lastTimeline)}
    `;
    const form = document.getElementById("ws-form");
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          const res = await api("POST", "/api/v1/workspaces", {
            id: fd.get("id"),
            name: fd.get("name"),
            cell: fd.get("cell"),
            customer_team_id: fd.get("customer_team_id"),
          });
          lastTimeline = res.timeline || lastTimeline;
          setFlash(res.ok, "");
          navigate(res.redirect || `/projects/${fd.get("id")}`);
        } catch (err) {
          lastTimeline = err.data && err.data.timeline || lastTimeline;
          setFlash("", err.message);
          await pageWorkspaces();
        }
      };
    }
  }

  async function pageProject(id) {
    setNav(id === "platform" ? "platform" : "workspaces");
    document.title = `Site ${id} · cell hierarchy`;
    const data = await api("GET", `/api/v1/projects/${encodeURIComponent(id)}`);
    lastTimeline = timelineFrom(data);
    const proj = data.project;
    if (!proj) {
      viewEl().innerHTML = `
        ${crumbs([{ label: "Workspaces", href: "/workspaces" }, { label: id }])}
        <h1>Site ${esc(id)}</h1>
        <p class="flash-err">${esc(data.error || "not found")}</p>
        ${renderTimeline(lastTimeline)}
      `;
      return;
    }
    const crumbItems = id === "platform"
      ? [{ label: "Platform", href: "/platform" }, { label: "platform project" }]
      : (proj.workspace_id && proj.workspace_id !== proj.id
        ? [
            { label: "Workspaces", href: "/workspaces" },
            { label: proj.workspace_id, href: `/projects/${proj.workspace_id}` },
            { label: id },
          ]
        : [{ label: "Workspaces", href: "/workspaces" }, { label: id }]);

    const users = (data.users || []).map((u) => {
      const del = u.deleted_at ? "" : `<button class="danger" type="button" data-del-email="${esc(u.email)}">Delete</button>`;
      const status = u.deleted_at ? "deleted" : (u.blocked ? "blocked" : "active");
      return `<tr class="${u.deleted_at ? "tombstoned" : ""}">
        <td>${esc(u.email)}</td><td>${u.epoch}</td><td class="muted">${status}</td><td>${del}</td></tr>`;
    }).join("");

    const lookup = (data.lookup || []).map((e) => {
      const prov = e.source === "child"
        ? `<span class="badge child">from child ${esc(e.via_project || "")}</span>`
        : `<span class="badge local">local</span>`;
      return `<tr><td>${esc(e.key)}</td><td><code>${esc(e.home_project_id)}</code></td>
        <td>${esc(e.state)}</td><td>${prov}</td></tr>`;
    }).join("");

    const children = (data.child_sites || []).map((s) =>
      `<tr><td><a href="/projects/${encodeURIComponent(s.id)}" data-link><code>${esc(s.id)}</code></a></td>
       <td>${esc(s.host_label)}</td><td>${s.user_count}</td></tr>`).join("");

    const cellOpts = (data.cells || []).map((c) =>
      `<option value="${esc(c.label)}">${esc(c.label)}</option>`).join("");
    const parentOpts = [`<option value="${esc(proj.id)}" selected>${esc(proj.id)} (this site)</option>`]
      .concat((data.parent_options || []).filter((p) => p.id !== proj.id).map((p) =>
        `<option value="${esc(p.id)}">${esc(p.id)} @ ${esc(p.host_label)}</option>`))
      .join("");

    viewEl().innerHTML = `
      ${crumbs(crumbItems)}
      <h1>Site ${esc(id)}</h1>
      <p class="hint">Site = project on one cell. Create users here; keys float up the parent-site chain. Lookup walks up (server-side hops).</p>
      ${data.error ? `<p class="flash-err">${esc(data.error)}</p>` : ""}
      <div class="panel">
        <h2>Site meta</h2>
        <p>
          <strong>${esc(proj.name)}</strong>
          ${proj.lookup_enabled ? `<span class="badge lookup">lookup on</span>` : `<span class="badge">lookup off</span>`}
          ${proj.workspace_id ? `<span class="badge">workspace ${esc(proj.workspace_id)}</span>` : ""}
          ${data.customer_team ? `<span class="badge">team ${esc(data.customer_team)}</span>` : ""}
        </p>
        <p class="muted">id=<code>${esc(proj.id)}</code> · cell=${esc(data.host_label || "")} · host=${esc(proj.host_cell_url || "")}</p>
        <p class="muted">parent_site=${proj.parent_project_id
          ? `<a href="/projects/${encodeURIComponent(proj.parent_project_id)}" data-link><code>${esc(proj.parent_project_id)}</code></a>`
          : "(none)"} · parent_cell=${esc(proj.parent_cell_url || "")}</p>
      </div>
      <div class="grid">
        <div class="panel">
          <h2>Create user</h2>
          <p class="muted">Creates on this site and floats the lookup key up parents.</p>
          <form id="user-form">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" required placeholder="joe@example.com"/>
            <button type="submit">Create user</button>
          </form>
        </div>
        <div class="panel">
          <h2>Lookup from here</h2>
          <p class="muted">Walks up the parent-site chain until a hit or root (delegated on cells).</p>
          <form id="lookup-form">
            <label for="key">Key</label>
            <input id="key" name="key" required placeholder="joe@example.com"/>
            <button type="submit">Lookup</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <h2>Users</h2>
        ${users ? `<table><thead><tr><th>Email</th><th>Epoch</th><th>Status</th><th></th></tr></thead><tbody>${users}</tbody></table>` : `<p class="muted">No users on this site.</p>`}
      </div>
      <div class="panel">
        <h2>Lookup table (this cell)</h2>
        <p class="muted">Provenance: <span class="badge local">local</span> · <span class="badge child">from child</span> floated keys.</p>
        ${lookup ? `<table><thead><tr><th>Key</th><th>Home</th><th>State</th><th>Provenance</th></tr></thead><tbody>${lookup}</tbody></table>` : `<p class="muted">Empty lookup table.</p>`}
      </div>
      <div class="panel">
        <h2>Child sites</h2>
        ${children ? `<table><thead><tr><th>Site</th><th>Cell</th><th>Users</th></tr></thead><tbody>${children}</tbody></table>` : `<p class="muted">No child sites attached to this site.</p>`}
        <h2 style="margin-top:1rem">Add child site</h2>
        <p class="muted">New project on another cell; lookup parent defaults to this site.</p>
        <form id="site-form">
          <input type="hidden" name="workspace_id" value="${esc(data.workspace_root || proj.id)}"/>
          <label for="site_id">Site id</label>
          <input id="site_id" name="id" required placeholder="acme-us2"/>
          <label for="site_cell">Cell</label>
          <select id="site_cell" name="cell" required>${cellOpts}</select>
          <label for="parent_project_id">Parent site</label>
          <select id="parent_project_id" name="parent_project_id">${parentOpts}</select>
          <button type="submit">Add site</button>
        </form>
      </div>
      ${renderTimeline(lastTimeline)}
    `;

    document.getElementById("user-form").onsubmit = async (e) => {
      e.preventDefault();
      const email = new FormData(e.target).get("email");
      try {
        const res = await api("POST", `/api/v1/projects/${encodeURIComponent(id)}/users`, { email });
        lastTimeline = res.timeline || lastTimeline;
        setFlash(res.ok, "");
        await pageProject(id);
      } catch (err) {
        lastTimeline = err.data && err.data.timeline || lastTimeline;
        setFlash("", err.message);
        await pageProject(id);
      }
    };

    document.getElementById("lookup-form").onsubmit = async (e) => {
      e.preventDefault();
      const key = new FormData(e.target).get("key");
      try {
        const res = await api("POST", `/api/v1/projects/${encodeURIComponent(id)}/lookup`, { key });
        lastTimeline = res.timeline || lastTimeline;
        setFlash(res.ok, "");
        await pageProject(id);
      } catch (err) {
        lastTimeline = err.data && err.data.timeline || lastTimeline;
        setFlash("", err.message);
        await pageProject(id);
      }
    };

    document.getElementById("site-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await api("POST", `/api/v1/projects/${encodeURIComponent(id)}/sites`, {
          id: fd.get("id"),
          cell: fd.get("cell"),
          parent_project_id: fd.get("parent_project_id"),
          workspace_id: fd.get("workspace_id"),
        });
        lastTimeline = res.timeline || lastTimeline;
        setFlash(res.ok, "");
        navigate(res.redirect || `/projects/${fd.get("id")}`);
      } catch (err) {
        lastTimeline = err.data && err.data.timeline || lastTimeline;
        setFlash("", err.message);
        await pageProject(id);
      }
    };

    viewEl().querySelectorAll("[data-del-email]").forEach((btn) => {
      btn.onclick = async () => {
        const email = btn.getAttribute("data-del-email");
        try {
          const res = await api("DELETE", `/api/v1/projects/${encodeURIComponent(id)}/users?email=${encodeURIComponent(email)}`);
          lastTimeline = res.timeline || lastTimeline;
          setFlash(res.ok, "");
          await pageProject(id);
        } catch (err) {
          lastTimeline = err.data && err.data.timeline || lastTimeline;
          setFlash("", err.message);
          await pageProject(id);
        }
      };
    });
  }

  function matchRoute(path) {
    if (path === "/" || path === "") return { name: "cells" };
    if (path === "/platform") return { name: "platform" };
    if (path === "/workspaces") return { name: "workspaces" };
    let m = path.match(/^\/cells\/([^/]+)\/?$/);
    if (m) return { name: "cell", label: decodeURIComponent(m[1]) };
    m = path.match(/^\/projects\/([^/]+)\/?$/);
    if (m) return { name: "project", id: decodeURIComponent(m[1]) };
    if (path === "/trace-view" || path === "/trace-page") return { name: "cells" };
    return { name: "cells" };
  }

  async function route() {
    const path = location.pathname;
    const r = matchRoute(path);
    try {
      if (r.name === "cells") await pageCells();
      else if (r.name === "cell") await pageCell(r.label);
      else if (r.name === "platform") await pagePlatform();
      else if (r.name === "workspaces") await pageWorkspaces();
      else if (r.name === "project") await pageProject(r.id);
    } catch (err) {
      setFlash("", err.message || String(err));
      viewEl().innerHTML = `<p class="flash-err">${esc(err.message || err)}</p>${renderTimeline(lastTimeline)}`;
    }
  }

  function navigate(path) {
    if (location.pathname !== path) {
      history.pushState({}, "", path);
    }
    setFlash(flash.ok, flash.err);
    route();
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link], .sidebar a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#")) return;
    if (a.target === "_blank") return;
    e.preventDefault();
    setFlash("", "");
    navigate(href);
  });

  window.addEventListener("popstate", () => {
    setFlash("", "");
    route();
  });

  document.getElementById("toggle-requests").onclick = () => {
    const p = requestsPanel();
    p.hidden = !p.hidden;
  };
  document.getElementById("close-requests").onclick = () => {
    requestsPanel().hidden = true;
  };
  document.getElementById("clear-requests").onclick = () => {
    requestLogEl().innerHTML = "";
  };

  // Show requests panel by default so network activity is obvious.
  requestsPanel().hidden = false;
  route();
})();
