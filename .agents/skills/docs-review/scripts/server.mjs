#!/usr/bin/env node
// Local notes server for the docs-review skill. See ../SKILL.md.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BODY = 1024 * 1024;
const ALLOWED_ORIGIN = /^(https:\/\/preview\.zitadel\.com|http:\/\/localhost(:\d+)?)$/;
const WIDGET_PATH = join(dirname(fileURLToPath(import.meta.url)), "widget.js");

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4777);
const endpoint = `http://127.0.0.1:${port}`;
const dataDir = resolve(args["data-dir"] ?? join(gitToplevel(process.cwd()), ".docs-review"));
const logPath = join(dataDir, "notes.jsonl");

if (args.bookmarklet) {
  printBookmarklets();
  process.exit(0);
}

const notes = loadLog(logPath);
createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("docs-review request failed", err);
    if (res.headersSent) res.destroy();
    else send(res, 500, { error: "internal error" }, { connection: "close" });
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`docs-review server on ${endpoint}, log ${logPath}, ${notes.size} notes`);
});

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
      out[arg.slice(2)] = argv[++i];
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

function gitToplevel(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function loadLog(path) {
  const state = new Map();
  if (!existsSync(path)) return state;
  const text = readFileSync(path, "utf8");
  // A crash mid-write leaves a partial last line; keep the next event off it.
  if (text.length && !text.endsWith("\n")) appendFileSync(path, "\n");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const id = event?.note?.id;
    if (!id) continue;
    if (event.op === "delete") state.delete(id);
    else state.set(id, event.note);
  }
  return state;
}

function appendEvent(op, actor, note) {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({ op, ts: new Date().toISOString(), actor, note })}\n`);
}

function readBody(req) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      if (size > MAX_BODY) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        chunks.length = 0;
        fail(Object.assign(new Error("body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("expected a JSON object"), { status: 400 });
  }
  return value;
}

function isJson(req) {
  const type = req.headers["content-type"] ?? "";
  return type.split(";")[0].trim().toLowerCase() === "application/json";
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== "string";
  res.writeHead(status, {
    "content-type": json ? "application/json" : "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(json ? JSON.stringify(body) : body);
}

async function handle(req, res) {
  const origin = req.headers.origin;
  const widget = typeof origin === "string" && ALLOWED_ORIGIN.test(origin);
  if (widget) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    if (widget) {
      res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-private-network", "true");
      res.setHeader("access-control-max-age", "600");
    }
    res.writeHead(204);
    res.end();
    return;
  }
  const actor = widget ? "widget" : "agent";
  const write = req.method === "POST" || req.method === "PATCH" || req.method === "DELETE";

  try {
    if (write && origin !== undefined && !widget) {
      return send(res, 403, { error: "origin not allowed" });
    }
    if ((req.method === "POST" || req.method === "PATCH") && !isJson(req)) {
      return send(res, 415, { error: "expected content-type: application/json" });
    }
    const url = new URL(req.url, endpoint);
    const idMatch = url.pathname.match(/^\/notes\/([^/]+)$/);
    let id = null;
    if (idMatch) {
      try {
        id = decodeURIComponent(idMatch[1]);
      } catch {
        return send(res, 400, { error: "malformed note id" });
      }
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, notes: notes.size, log: logPath });
    }
    if (req.method === "GET" && url.pathname === "/widget.js") {
      const src = readFileSync(WIDGET_PATH, "utf8").replaceAll("__ZRN_ENDPOINT__", endpoint);
      return send(res, 200, src, { "content-type": "text/javascript; charset=utf-8" });
    }
    if (req.method === "GET" && url.pathname === "/notes") {
      return send(res, 200, [...notes.values()]);
    }
    if (req.method === "POST" && url.pathname === "/notes") {
      const body = await readJson(req);
      if (typeof body.id !== "string" || !body.id) {
        return send(res, 400, { error: "note needs a string id" });
      }
      const existing = notes.get(body.id);
      if (existing) return send(res, 200, existing);
      const note = {
        status: "new",
        ...body,
        createdAt: body.createdAt ?? new Date().toISOString(),
      };
      notes.set(note.id, note);
      appendEvent("add", actor, note);
      return send(res, 201, note);
    }
    if (req.method === "PATCH" && id) {
      const existing = notes.get(id);
      if (!existing) return send(res, 404, { error: "no such note" });
      const patch = await readJson(req);
      const note = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
      notes.set(id, note);
      appendEvent("update", actor, note);
      return send(res, 200, note);
    }
    if (req.method === "DELETE" && id) {
      const existing = notes.get(id);
      if (!existing) return send(res, 404, { error: "no such note" });
      notes.delete(id);
      appendEvent("delete", actor, existing);
      res.writeHead(204);
      res.end();
      return;
    }
    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, err.status ?? 500, { error: err.message }, { connection: "close" });
  }
}

function printBookmarklets() {
  const loader =
    `(()=>{if(window.__zrn){window.__zrn.toggle(true);return}` +
    `const s=document.createElement('script');s.src='${endpoint}/widget.js?'+Date.now();` +
    `document.documentElement.appendChild(s)})()`;
  const widget = readFileSync(WIDGET_PATH, "utf8")
    .replaceAll("__ZRN_ENDPOINT__", endpoint)
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("//"))
    .join("\n");
  process.stdout.write(
    [
      "(a) loader, adds <script> tag:",
      `javascript:void ${loader}`,
      "",
      "(b) inline widget, for pages whose CSP blocks (a):",
      `javascript:${encodeURIComponent(`void ${widget}`)}`,
      "",
    ].join("\n"),
  );
}
