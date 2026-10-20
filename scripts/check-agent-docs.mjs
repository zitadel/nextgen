#!/usr/bin/env node
// Keeps the agent docs small and their links honest. It fails on:
//
//   1. A link in a Markdown file whose file or #anchor does not resolve:
//      relative links, and links to this repository's main branch on GitHub.
//      Fenced and inline code hold no links, and the changesets in
//      .changeset/ are skipped (its README is not).
//   2. A doc anchor cited from any other file that does not resolve:
//      `docs/x.md#anchor`, `docs/x.md` → "Heading" or `docs/x.md` §Heading.
//   3. An AGENTS.md over budget: the root one over 8 KiB, any other over
//      6 KiB, or the root one plus every AGENTS.md on the path to a folder over
//      24 KiB, which leaves headroom under the 32 KiB Codex reads at most.
//   4. A tracked CLAUDE.md: while one exists, Claude Code loads it and never
//      AGENTS.md.
//
// Anchors are GitHub's: the heading text lowercased, everything but letters,
// digits, spaces, `-` and `_` dropped, spaces turned into `-`, and a repeated
// heading suffixed -1, -2, ….
//
// scripts/check-agent-docs.baseline.json holds what the check tolerates until
// the docs are trimmed: the AGENTS.md files and chains over budget, each at
// its recorded size, and the CLAUDE.md files, which only warn. A size that
// moves either way fails, and so does an entry that no longer applies, so the
// baseline only ever shrinks: after a trim, `--update-baseline` records it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun } from "./dev-process.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_FILE = "scripts/check-agent-docs.baseline.json";
const UPDATE_COMMAND = "node scripts/check-agent-docs.mjs --update-baseline";

const KIB = 1024;
export const BUDGETS = { root: 8 * KIB, scoped: 6 * KIB, chain: 24 * KIB };

// Link targets allowed not to exist, with why. Forward references to what is
// not written yet belong here; a typo does not. An entry that exists now, or
// that nothing links to any more, fails the check until it is removed.
const MISSING_ALLOWED = new Map([
  [
    "docs/design/policies/catalog.md",
    "the index of guarded operations ADR 066 (Draft) defines; written with the engine",
  ],
  ["internal/policy", "the policy engine package ADR 066 (Draft) defines; not written yet"],
  [
    "packages/config/src/idp/N-doc.md",
    "a placeholder in a comment that spells out the link format its test checks",
  ],
]);

// The check's own source and tests spell out citations as examples.
const NOT_CITING = new Set(["scripts/check-agent-docs.mjs", "scripts/check-agent-docs.test.mjs"]);

// github-slugger's rule: keep letters, marks, decimal and letter numbers,
// connector punctuation such as `_`, `-` and the space; drop everything else.
const SLUG_DROP = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}\p{Alphabetic} -]/gu;

export function githubSlug(text) {
  return text.toLowerCase().replace(SLUG_DROP, "").replaceAll(" ", "-");
}

// One slugger per document: a repeated heading gets -1, -2, … appended, the
// way github-slugger counts them.
export function createSlugger() {
  const seen = new Map();
  return (text) => {
    const base = githubSlug(text);
    let slug = base;
    while (seen.has(slug)) {
      seen.set(base, seen.get(base) + 1);
      slug = `${base}-${seen.get(base)}`;
    }
    seen.set(slug, 0);
    return slug;
  };
}

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
// Placeholders from Unicode's private use area, which no document contains.
const OPEN_SLOT = String.fromCodePoint(0xe000);
const CLOSE_SLOT = String.fromCodePoint(0xe001);
const SLOT = new RegExp(`${OPEN_SLOT}(\\d+)${CLOSE_SLOT}`, "g");

// Replaces each code span and backslash escape with a placeholder, CommonMark
// style: a run of n backticks opens a span the next run of exactly n closes,
// and an escaped backtick opens nothing. What is left is plain inline text.
function maskInline(text) {
  const slots = [];
  const slot = (value) => `${OPEN_SLOT}${slots.push(value) - 1}${CLOSE_SLOT}`;
  let masked = "";
  for (let index = 0; index < text.length; ) {
    if (text[index] === "\\" && ASCII_PUNCTUATION.test(text[index + 1] ?? "")) {
      masked += slot({ text: text[index + 1] });
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      const open = backtickRun(text, index);
      let close = index + open;
      while (close < text.length && (text[close] !== "`" || backtickRun(text, close) !== open)) {
        close += text[close] === "`" ? backtickRun(text, close) : 1;
      }
      if (close >= text.length) {
        masked += text.slice(index, index + open);
        index += open;
        continue;
      }
      masked += slot({ code: text.slice(index + open, close) });
      index = close + open;
      continue;
    }
    masked += text[index];
    index += 1;
  }
  return { masked, slots };
}

function backtickRun(text, index) {
  let end = index;
  while (text[end] === "`") end += 1;
  return end - index;
}

function unmask(text, slots) {
  return text.replace(SLOT, (_, index) => {
    const value = slots[Number(index)];
    return value.code === undefined ? value.text : value.code.trim();
  });
}

// A code span inside a link destination makes it no link at all: code spans
// bind tighter than links.
function holdsCode(text, slots) {
  return [...text.matchAll(SLOT)].some((match) => slots[Number(match[1])].code !== undefined);
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: String.fromCodePoint(0xa0),
};

function decodeEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hex, name) => {
    const codePoint = decimal ? Number(decimal) : hex ? Number.parseInt(hex, 16) : null;
    if (codePoint === null) return ENTITIES[name.toLowerCase()] ?? entity;
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });
}

// `*` and `~` fall to the slug anyway; `_` survives it, so emphasis made of
// `_` is unwrapped here (but not intraword underscores, as in snake_case).
function unwrapUnderscores(text) {
  let previous;
  let current = text;
  do {
    previous = current;
    current = current.replace(
      /(^|[^\p{L}\p{N}_])(_{1,3})(?=\S)(.*?\S)\2(?![\p{L}\p{N}_])/gu,
      "$1$3",
    );
  } while (current !== previous);
  return current;
}

// The text GitHub slugs for a heading, as it renders: link text without the
// link, code without backticks, and no images, tags or emphasis.
export function headingText(raw) {
  const { masked, slots } = maskInline(raw.trim());
  const text = masked
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<([a-z][a-z\d+.-]*:[^\s<>]*)>/gi, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  return unmask(decodeEntities(unwrapUnderscores(text)), slots);
}

const FENCE = /^(?:\s*>)*\s*(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^ {0,3}#{1,6}(?=[ \t]|$)(.*)$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
// Lines that cannot be the text of a setext heading: list items, table rows,
// HTML, link definitions and indented code.
const NOT_HEADING_TEXT = /^(?: {4}|\s*(?:[-*+]|\d+[.)])(?:\s|$)|\s*[|<]|\s*\[[^\]]+\]:)/;
const INLINE_LINK =
  /\]\(\s*(?:<([^<>\n]*)>|((?:[^\s()]|\([^\s()]*\))+))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;
// Not footnotes (`[^1]: …`), which look like link definitions.
const LINK_DEFINITION = /^ {0,3}\[(?!\^)[^\]]+\]:\s*(?:<([^<>\n]*)>|(\S+))/;
const HTML_LINK = /<(?:a|img|source)\b[^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const HTML_ANCHOR = /<(?:a\b[^>]*?\s(?:id|name)|[a-z][^>]*?\sid)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

// The headings, anchors and links of one Markdown document. Front matter and
// fenced code are skipped, and inline code is masked before links are matched.
export function parseMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const slug = createSlugger();
  const headings = [];
  const anchors = new Set();
  const links = [];
  const addHeading = (raw, line) => {
    const text = headingText(raw);
    const anchor = slug(text);
    headings.push({ text, slug: anchor, base: githubSlug(text), line });
    anchors.add(anchor);
  };

  let start = 0;
  if (/^---\s*$/.test(lines[0])) {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
    if (end !== -1) start = end + 1;
  }

  let fence = null;
  let paragraph = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(FENCE);
    if (fence) {
      const closes =
        fenceMatch?.[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === "";
      if (closes) fence = null;
      continue;
    }
    if (fenceMatch && !(fenceMatch[1][0] === "`" && fenceMatch[2].includes("`"))) {
      fence = fenceMatch[1];
      paragraph = [];
      continue;
    }

    const { masked, slots } = maskInline(line);
    const addLink = (target) => {
      if (!holdsCode(target, slots)) links.push({ target: unmask(target, slots), line: index + 1 });
    };
    for (const match of masked.matchAll(INLINE_LINK)) addLink(match[1] ?? match[2]);
    const definition = masked.match(LINK_DEFINITION);
    if (definition) addLink(definition[1] ?? definition[2]);
    for (const match of masked.matchAll(HTML_LINK)) addLink(match[1] ?? match[2]);
    for (const match of masked.matchAll(HTML_ANCHOR)) anchors.add(match[1] ?? match[2]);

    const content = line.replace(/^(?: {0,3}>[ \t]?)+/, "");
    const atx = content.match(ATX_HEADING);
    if (atx) {
      addHeading(atx[1].replace(/(?:^|[ \t]+)#+[ \t]*$/, ""), index + 1);
      paragraph = [];
    } else if (SETEXT_UNDERLINE.test(content) && paragraph.length > 0) {
      addHeading(paragraph.map((part) => part.text).join(" "), paragraph[0].line);
      paragraph = [];
    } else if (content.trim() === "" || NOT_HEADING_TEXT.test(content)) {
      paragraph = [];
    } else {
      paragraph.push({ text: content.trim(), line: index + 1 });
    }
  }
  return { headings, anchors, links };
}

const REPO_URL =
  /^https?:\/\/github\.com\/zitadel\/nextgen\/(?:blob|tree)\/main\/([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Where a link in `from` points: a repository path ("" is the root) and the
// anchor, or null for a link out of the repository.
export function resolveLink(from, target) {
  let path;
  let anchor;
  const repoUrl = target.match(REPO_URL);
  if (repoUrl) {
    path = decode(repoUrl[1]);
    anchor = repoUrl[2];
  } else {
    if (URL_SCHEME.test(target) || target.startsWith("//")) return null;
    const hash = target.indexOf("#");
    const rawPath = (hash === -1 ? target : target.slice(0, hash)).replace(/\?.*$/, "");
    anchor = hash === -1 ? undefined : target.slice(hash + 1);
    const decoded = decode(rawPath);
    if (decoded === "") path = from;
    else if (decoded.startsWith("/")) path = decoded.replace(/^\/+/, "");
    else path = posix.join(posix.dirname(from), decoded);
  }
  path = posix.normalize(path).replace(/\/+$/, "");
  return {
    path: path === "." ? "" : path,
    anchor: anchor === undefined ? undefined : decode(anchor),
  };
}

const CITED_PATH = String.raw`((?:\.{1,2}\/)*(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.md)`;
const ANCHOR_CITATION = new RegExp(
  String.raw`(?<![\w./@-])${CITED_PATH}#([\p{L}\p{M}\p{N}_%-]+)`,
  "gu",
);
const HEADING_CITATION = new RegExp(
  String.raw`(?<![\w./@-])${CITED_PATH}\x60?\)?[ \t]*(→|->|§)`,
  "gu",
);
const REPO_URL_IN_TEXT =
  /https?:\/\/github\.com\/zitadel\/nextgen\/(?:blob|tree)\/main\/([^\s?#)\]>"'`]*)(?:\?[^\s#)\]>"'`]*)?(?:#([\p{L}\p{M}\p{N}_%-]+))?/giu;
const OTHER_URL = /[a-z][a-z\d+.-]*:\/\/[^\s)\]>"'`]+/gi;
const COMMENT_PREFIX = /^\s*(?:\*|\/\/|#|--|;)?\s*/;

// The doc anchors a file other than Markdown cites: `path.md#anchor`,
// `path.md` → "Heading" (the quote may wrap onto the next comment lines) and
// `path.md` §Heading (the heading starts the rest of the line). A link to this
// repository's main branch names a root-relative path; other URLs cite nothing.
export function findCitations(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const citations = [];
  const blank = (match) => " ".repeat(match.length);
  lines.forEach((line, index) => {
    const at = index + 1;
    let rest = line.replace(REPO_URL_IN_TEXT, (url, path, anchor) => {
      if (anchor !== undefined && /\.md$/i.test(path)) {
        citations.push({ line: at, path: `/${decode(path)}`, anchor });
      }
      return blank(url);
    });
    rest = rest.replace(OTHER_URL, blank);
    for (const match of rest.matchAll(ANCHOR_CITATION)) {
      citations.push({ line: at, path: match[1], anchor: match[2] });
    }
    for (const match of rest.matchAll(HEADING_CITATION)) {
      const after = rest.slice(match.index + match[0].length);
      if (match[2] === "§") {
        const section = after.replace(/\*\/.*$/, "").trim();
        if (section) citations.push({ line: at, path: match[1], section });
      } else {
        const heading = quotedText(after, lines, index);
        if (heading) citations.push({ line: at, path: match[1], heading });
      }
    }
  });
  return citations;
}

function quotedText(after, lines, index) {
  const open = after.match(/^\s*["“]/);
  if (!open) return null;
  let text = after.slice(open[0].length);
  for (
    let next = index + 1;
    !/["”]/.test(text) && next <= index + 3 && next < lines.length;
    next += 1
  ) {
    text += ` ${lines[next].replace(COMMENT_PREFIX, "")}`;
  }
  const close = text.search(/["”]/);
  return close === -1 ? null : text.slice(0, close).trim().replace(/\s+/g, " ");
}

// Where a citation in `from` may point, in order: a path with a directory is
// relative to the citing file or to the root, and a bare file name means the
// nearest one up the tree.
function citationCandidates(from, path) {
  if (path.startsWith("/")) return [posix.normalize(path.slice(1))];
  const dir = posix.dirname(from);
  if (/^\.\.?\//.test(path)) return [posix.join(dir, path)];
  if (path.includes("/")) return [posix.join(dir, path), posix.normalize(path)];
  const candidates = [];
  for (let current = dir; ; current = posix.dirname(current)) {
    candidates.push(current === "." ? path : `${current}/${path}`);
    if (current === ".") return candidates;
  }
}

function missingCitation(from, path, candidates) {
  if (candidates.length === 1) return `${candidates[0]} does not exist`;
  if (path.includes("/")) return `neither ${candidates[0]} nor ${candidates[1]} exists`;
  return `no ${path} in ${posix.dirname(from)} or a folder above it`;
}

// A heading cited by its text matches when one slug starts the other: the
// citation may shorten the heading, or run on into the sentence around it.
function citesHeading(heading, headings) {
  const wanted = githubSlug(heading).replace(/-+$/, "");
  return headings.some(
    ({ base }) => base === wanted || base.startsWith(`${wanted}-`) || wanted.startsWith(`${base}-`),
  );
}

// Each AGENTS.md against its budget, and each chain — the root AGENTS.md plus
// every AGENTS.md on the path to a folder — against the chain budget.
export function measureAgentsDocs(sizes) {
  const files = [...sizes].map(([path, size]) => ({
    key: path,
    size,
    budget: path === "AGENTS.md" ? BUDGETS.root : BUDGETS.scoped,
  }));
  const chains = [];
  for (const path of sizes.keys()) {
    if (path === "AGENTS.md") continue;
    const parts = posix.dirname(path).split("/");
    const members = ["AGENTS.md"];
    for (let depth = 1; depth <= parts.length; depth += 1) {
      members.push(`${parts.slice(0, depth).join("/")}/AGENTS.md`);
    }
    const present = members.filter((member) => sizes.has(member));
    chains.push({
      key: posix.dirname(path),
      size: present.reduce((total, member) => total + sizes.get(member), 0),
      budget: BUDGETS.chain,
      members: present,
    });
  }
  const byKey = (left, right) => byCodeUnit(left.key, right.key);
  return { files: files.sort(byKey), chains: chains.sort(byKey) };
}

// Not localeCompare: the baseline must sort the same on every machine.
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const bytes = (size) => `${size.toLocaleString("en-US")} bytes`;
const budget = (size) => `${size.toLocaleString("en-US")}-byte budget`;

// Holds measured sizes against the baseline: one over budget must match its
// recorded size, and a recorded one must still be over budget.
function compareToBaseline({ measured, recorded, name, errors }) {
  const over = measured.filter((item) => item.size > item.budget);
  for (const item of over) {
    const was = recorded[item.key];
    const subject = `${name(item)} is ${bytes(item.size)}, over the ${budget(item.budget)}`;
    if (was === undefined) {
      errors.push(`${subject}; trim it`);
    } else if (item.size > was) {
      errors.push(`${subject} and up from the ${bytes(was)} the baseline records; trim it back`);
    } else if (item.size < was) {
      errors.push(
        `${subject} and down from the ${bytes(was)} the baseline records; ` +
          `run \`${UPDATE_COMMAND}\` to keep the trim`,
      );
    }
  }
  for (const key of Object.keys(recorded)) {
    if (!over.some((item) => item.key === key)) {
      errors.push(
        `${key} is in the baseline but not over budget any more; run \`${UPDATE_COMMAND}\``,
      );
    }
  }
  return Object.fromEntries(over.map((item) => [item.key, item.size]));
}

export function emptyBaseline() {
  return { oversized: {}, oversizedChains: {}, claudeMd: [] };
}

// Runs every check over the repository's `files`; `read(path)` returns a
// file's contents as a Buffer.
export function checkAgentDocs({
  files,
  read,
  baseline = emptyBaseline(),
  missingAllowed = MISSING_ALLOWED,
}) {
  const errors = [];
  const warnings = [];
  const fileSet = new Set(files);
  const dirs = new Set([""]);
  for (const file of files) {
    for (let dir = posix.dirname(file); dir !== "."; dir = posix.dirname(dir)) dirs.add(dir);
  }

  const parsed = new Map();
  const parse = (path) => {
    if (!parsed.has(path)) parsed.set(path, parseMarkdown(read(path).toString("utf8")));
    return parsed.get(path);
  };
  const anchorProblem = (path, anchor) => {
    const { anchors } = parse(path);
    // `#top` is the top of any page.
    if (anchor === "" || anchors.has(anchor) || anchor.toLowerCase() === "top") return null;
    const hint = anchors.has(anchor.toLowerCase())
      ? ` (anchors are lowercase: #${anchor.toLowerCase()})`
      : "";
    return `${path} has no heading for #${anchor}${hint}`;
  };
  const allowedHits = new Set();
  const allowedMissing = (path) => {
    const entry = [...missingAllowed.keys()].find(
      (allowed) => path === allowed || path.startsWith(`${allowed}/`),
    );
    if (entry) allowedHits.add(entry);
    return entry !== undefined;
  };
  // Why a repository path and anchor do not resolve, or null when they do.
  const targetProblem = ({ path, anchor }) => {
    if (path === ".." || path.startsWith("../")) return "it points outside the repository";
    if (fileSet.has(path)) {
      return anchor && /\.md$/i.test(path) ? anchorProblem(path, anchor) : null;
    }
    if (dirs.has(path)) {
      if (!anchor || anchor === "readme") return null;
      const readme = files.find(
        (file) =>
          posix.dirname(file) === (path || ".") && /^readme\.md$/i.test(posix.basename(file)),
      );
      return readme ? anchorProblem(readme, anchor) : `${path || "the root"} has no README.md`;
    }
    return allowedMissing(path) ? null : `${path} does not exist`;
  };

  const checked = (file) => !(file.startsWith(".changeset/") && file !== ".changeset/README.md");
  let markdownCount = 0;
  let linkCount = 0;
  let citationCount = 0;
  for (const file of files) {
    if (/\.md$/i.test(file)) {
      if (!checked(file)) continue;
      markdownCount += 1;
      for (const { target, line } of parse(file).links) {
        const resolved = resolveLink(file, target);
        if (!resolved) continue;
        linkCount += 1;
        const problem = targetProblem(resolved);
        if (problem) errors.push(`${file}:${line}: links to ${target}: ${problem}`);
      }
      continue;
    }
    if (NOT_CITING.has(file)) continue;
    const content = read(file);
    if (content.subarray(0, 8000).includes(0)) continue;
    for (const citation of findCitations(content.toString("utf8"))) {
      citationCount += 1;
      const candidates = citationCandidates(file, citation.path);
      const path = candidates.find((candidate) => fileSet.has(candidate));
      const heading = citation.heading ?? citation.section;
      let problem = null;
      if (path === undefined) {
        if (!candidates.some(allowedMissing)) {
          problem = missingCitation(file, citation.path, candidates);
        }
      } else if (heading === undefined) {
        problem = anchorProblem(path, decode(citation.anchor));
      } else if (!citesHeading(heading, parse(path).headings)) {
        problem = `${path} has no such heading`;
      }
      if (problem) {
        const cited =
          citation.anchor !== undefined
            ? `${citation.path}#${citation.anchor}`
            : citation.section !== undefined
              ? `${citation.path} §${citation.section}`
              : `${citation.path} → "${citation.heading}"`;
        errors.push(`${file}:${citation.line}: cites ${cited}: ${problem}`);
      }
    }
  }
  for (const [entry, why] of missingAllowed) {
    if (fileSet.has(entry) || dirs.has(entry)) {
      errors.push(
        `${entry} exists now; drop it from MISSING_ALLOWED in scripts/check-agent-docs.mjs (${why})`,
      );
    } else if (!allowedHits.has(entry)) {
      errors.push(
        `nothing links to ${entry} any more; drop it from MISSING_ALLOWED in scripts/check-agent-docs.mjs`,
      );
    }
  }

  const sizes = new Map();
  for (const file of files) {
    if (posix.basename(file) === "AGENTS.md") {
      // Counted as committed, so a CRLF checkout measures the same.
      sizes.set(file, Buffer.byteLength(read(file).toString("utf8").replaceAll("\r\n", "\n")));
    }
  }
  const { files: agentsDocs, chains } = measureAgentsDocs(sizes);
  const oversized = compareToBaseline({
    measured: agentsDocs,
    recorded: baseline.oversized,
    name: (item) => item.key,
    errors,
  });
  const oversizedChains = compareToBaseline({
    measured: chains,
    recorded: baseline.oversizedChains,
    name: (item) => `${item.key}/ reads ${item.members.join(" + ")}, which`,
    errors,
  });

  const claudeMd = files.filter((file) => posix.basename(file) === "CLAUDE.md");
  for (const file of claudeMd) {
    const message = `${file} is tracked: while a CLAUDE.md exists, Claude Code never loads AGENTS.md; delete it`;
    (baseline.claudeMd.includes(file) ? warnings : errors).push(message);
  }
  for (const file of baseline.claudeMd) {
    if (!claudeMd.includes(file)) {
      errors.push(`${file} is in the baseline but gone; run \`${UPDATE_COMMAND}\``);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: { markdown: markdownCount, links: linkCount, citations: citationCount },
    measured: { oversized, oversizedChains, claudeMd },
  };
}

// The baseline that records `measured`, and what keeps it from being
// recorded: against a `previous` baseline, an entry may only shrink or go.
export function nextBaseline(previous, measured) {
  const refused = [];
  if (previous) {
    for (const key of ["oversized", "oversizedChains"]) {
      for (const [entry, size] of Object.entries(measured[key])) {
        const was = previous[key][entry];
        if (was === undefined) refused.push(`${entry} is over budget and not in the baseline`);
        else if (size > was) refused.push(`${entry} grew from ${bytes(was)} to ${bytes(size)}`);
      }
    }
    for (const file of measured.claudeMd) {
      if (!previous.claudeMd.includes(file)) refused.push(`${file} is a new CLAUDE.md`);
    }
  }
  const sorted = (entries) =>
    Object.fromEntries(Object.entries(entries).sort(([left], [right]) => byCodeUnit(left, right)));
  return {
    refused,
    baseline: {
      oversized: sorted(measured.oversized),
      oversizedChains: sorted(measured.oversizedChains),
      claudeMd: [...measured.claudeMd].sort(byCodeUnit),
    },
  };
}

// The files git tracks, plus untracked ones it would add, so a new doc and the
// links to it check out before they are committed; deleted ones do not count.
function repositoryFiles(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const files = new Set(output.split("\0").filter((file) => file !== "" && !file.endsWith("/")));
  return [...files].filter((file) => existsSync(join(root, file))).sort();
}

function readBaseline(path) {
  if (!existsSync(path)) return null;
  return { ...emptyBaseline(), ...JSON.parse(readFileSync(path, "utf8")) };
}

export async function main() {
  const args = forwardedArgs();
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return 0;
  }

  const baselinePath = join(repoRoot, BASELINE_FILE);
  const previous = readBaseline(baselinePath);
  const report = checkAgentDocs({
    files: repositoryFiles(repoRoot),
    read: (file) => readFileSync(join(repoRoot, file)),
    baseline: previous ?? emptyBaseline(),
  });

  if (args.includes("--update-baseline")) {
    const { refused, baseline } = nextBaseline(previous, report.measured);
    if (refused.length > 0) {
      console.error("agent docs: the baseline only shrinks; trim these first:");
      for (const reason of refused) console.error(`- ${reason}`);
      return 1;
    }
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`agent docs: wrote ${BASELINE_FILE}`);
    return 0;
  }

  for (const warning of report.warnings) console.warn(`agent docs: warning: ${warning}`);
  if (report.ok) {
    const [markdown, links, citations] = Object.values(report.stats).map((count) =>
      count.toLocaleString("en-US"),
    );
    const held =
      Object.keys(report.measured.oversized).length +
      Object.keys(report.measured.oversizedChains).length;
    console.log(
      `agent docs: ok (${markdown} Markdown files, ${links} links, ${citations} citations` +
        `${held > 0 ? `; ${held} over-budget AGENTS.md files and chains held by the baseline` : ""})`,
    );
    return 0;
  }

  console.error("agent docs: failed");
  for (const error of report.errors) console.error(`- ${error}`);
  return 1;
}

function printUsage() {
  console.log(`Usage: node scripts/check-agent-docs.mjs [--update-baseline]

Checks that every link and #anchor in the repository's Markdown resolves, that
every doc anchor other files cite resolves, that each AGENTS.md stays within
budget (the root one ${bytes(BUDGETS.root)}, any other ${bytes(BUDGETS.scoped)}, the root one
plus those on the path to a folder ${bytes(BUDGETS.chain)}), and that no CLAUDE.md is
tracked.

--update-baseline  record the current over-budget sizes and CLAUDE.md files in
                   ${BASELINE_FILE}; refuses to record growth.
`);
}

if (isDirectRun(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
