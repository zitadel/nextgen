import assert from "node:assert/strict";
import { test } from "vitest";

import {
  BUDGETS,
  checkAgentDocs,
  createSlugger,
  emptyBaseline,
  findCitations,
  githubSlug,
  headingText,
  nextBaseline,
  parseMarkdown,
  resolveLink,
} from "./check-agent-docs.mjs";

// An in-memory repository: path → contents.
function check(tree, options = {}) {
  return checkAgentDocs({
    files: Object.keys(tree).sort(),
    read: (path) => Buffer.from(tree[path]),
    missingAllowed: new Map(),
    ...options,
  });
}

const slugsOf = (markdown) => parseMarkdown(markdown).headings.map((heading) => heading.slug);
const targetsOf = (markdown) => parseMarkdown(markdown).links.map((link) => link.target);

test("slugs lowercase, drop punctuation and turn spaces into dashes", () => {
  assert.equal(githubSlug("What's in here?"), "whats-in-here");
  assert.equal(githubSlug("ADR 047: Dialect IDs"), "adr-047-dialect-ids");
  assert.equal(
    githubSlug("Lit reactivity — always use accessor"),
    "lit-reactivity--always-use-accessor",
  );
  assert.equal(githubSlug("snake_case and kebab-case"), "snake_case-and-kebab-case");
  assert.equal(githubSlug("Node.js version (24)"), "nodejs-version-24");
});

test("slugs keep letters beyond ASCII and drop symbols and emoji", () => {
  assert.equal(githubSlug("Über Café"), "über-café");
  assert.equal(githubSlug("🚀 Launch → done ©"), "-launch--done-");
  assert.equal(githubSlug("x² ½"), "x-");
});

test("a repeated heading gets -1, -2, … the way github-slugger counts", () => {
  const slug = createSlugger();
  assert.deepEqual(
    ["Usage", "Usage", "Usage 1", "Usage"].map((text) => slug(text)),
    ["usage", "usage-1", "usage-1-1", "usage-2"],
  );
});

test("heading text is what GitHub renders: no link syntax, backticks, images or tags", () => {
  assert.equal(headingText("The `zl-select` atom"), "The zl-select atom");
  assert.equal(headingText("[Moon](https://moonrepo.dev) **tasks**"), "Moon **tasks**");
  assert.equal(headingText("_Emphasis_ but snake_case"), "Emphasis but snake_case");
  assert.equal(headingText("Logo ![alt](logo.svg) <code>x</code>"), "Logo  x");
  assert.equal(headingText("Q&amp;A \\_not emphasis\\_"), "Q&A _not emphasis_");
  assert.equal(headingText("`a_b_` and `` ` ``"), "a_b_ and `");
});

test("ATX and setext headings both slug, closing hashes do not", () => {
  const markdown = [
    "# Title #",
    "",
    "Setext one",
    "==========",
    "",
    "Setext",
    "two",
    "---",
    "",
    "> ## Quoted heading",
    "",
    "#not-a-heading",
    "- item",
    "---",
  ].join("\n");
  assert.deepEqual(slugsOf(markdown), ["title", "setext-one", "setext-two", "quoted-heading"]);
});

test("fenced code, inline code and front matter hold no links or headings", () => {
  const markdown = [
    "---",
    "title: [x](front-matter.md)",
    "---",
    "",
    "````md",
    "# not a heading",
    "```",
    "[x](in-fence.md)",
    "```",
    "````",
    "",
    "~~~",
    "[x](tilde-fence.md)",
    "~~~",
    "",
    "Use `[x](inline-code.md)` or ``[y](`double`.md)``, but [real](real.md).",
    "A code span in a destination is no link: [x](`a`.md)",
    "\\[escaped\\](escaped.md) is text.",
  ].join("\n");
  assert.deepEqual(targetsOf(markdown), ["real.md"]);
  assert.deepEqual(slugsOf(markdown), []);
});

test("links come from inline links, images, definitions and HTML, not footnotes", () => {
  const markdown = [
    '[a](a.md "title") ![b](img/b.png) [c](<with space.md>) [d](d.md#anchor)',
    "[ref]: ref.md",
    "[^1]: A footnote, not a link definition.",
    '<a href="html.md">x</a> <img src="html.png">',
    "[e](https://example.com) [f](wiki/Foo_(bar).md)",
  ].join("\n");
  assert.deepEqual(targetsOf(markdown), [
    "a.md",
    "img/b.png",
    "with space.md",
    "d.md#anchor",
    "ref.md",
    "html.md",
    "html.png",
    "https://example.com",
    "wiki/Foo_(bar).md",
  ]);
});

test("explicit id and name attributes are anchors too", () => {
  const { anchors } = parseMarkdown(
    '<a name="legacy"></a>\n<span id="kept">x</span>\n<meta name="no">',
  );
  assert.deepEqual([...anchors].sort(), ["kept", "legacy"]);
});

test("links resolve against the linking file, or the root when absolute", () => {
  assert.deepEqual(resolveLink("docs/adrs/001.md", "../design/x.md#part"), {
    path: "docs/design/x.md",
    anchor: "part",
  });
  assert.deepEqual(resolveLink("docs/a.md", "/apps/cli/"), { path: "apps/cli", anchor: undefined });
  assert.deepEqual(resolveLink("docs/a.md", "#local"), { path: "docs/a.md", anchor: "local" });
  assert.deepEqual(resolveLink("a.md", "b%20c.md?plain=1#L3"), { path: "b c.md", anchor: "L3" });
  assert.deepEqual(resolveLink("docs/a.md", "../.."), { path: "..", anchor: undefined });
});

test("links to this repository's main branch are repository paths, others are external", () => {
  assert.deepEqual(
    resolveLink(
      "README.md",
      "https://github.com/zitadel/nextgen/blob/main/apps/cli/README.md#usage",
    ),
    { path: "apps/cli/README.md", anchor: "usage" },
  );
  assert.deepEqual(resolveLink("README.md", "https://github.com/zitadel/nextgen/tree/main/apps"), {
    path: "apps",
    anchor: undefined,
  });
  for (const external of [
    "https://github.com/zitadel/nextgen/blob/15bd7f4/docs/x.md",
    "https://example.com/x.md",
    "mailto:security@zitadel.com",
    "//cdn.example.com/x.js",
  ]) {
    assert.equal(resolveLink("README.md", external), null, external);
  }
});

test("citations name a doc anchor or heading from outside Markdown", () => {
  const source = [
    "// Rule: CONTRIBUTING.md#title-format.",
    '# description: "[secret.md](../secret.md#capability-matrix) applies"',
    "// see https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#teams",
    "// pinned: https://github.com/zitadel/nextgen/blob/15bd7f4/docs/x.md#gone",
    "// elsewhere: https://example.com/guide.md#intro",
    ' * contract (see `packages/components/AGENTS.md` → "Input atoms expose',
    ' * a real native control"): the control is native.',
    " * Per `docs/design/branding/schema.md` §Shape invariants:",
    "const notes = { file: 'README.md' };",
  ].join("\n");
  assert.deepEqual(findCitations(source), [
    { line: 1, path: "CONTRIBUTING.md", anchor: "title-format" },
    { line: 2, path: "../secret.md", anchor: "capability-matrix" },
    { line: 3, path: "/docs/design/api/resource-map.md", anchor: "teams" },
    {
      line: 6,
      path: "packages/components/AGENTS.md",
      heading: "Input atoms expose a real native control",
    },
    { line: 8, path: "docs/design/branding/schema.md", section: "Shape invariants:" },
  ]);
});

test("broken files and anchors fail, with a hint for an uppercase anchor", () => {
  const report = check({
    "README.md": [
      "# Zitadel",
      "## Getting started",
      "[ok](docs/guide.md#install) [dir](docs/) [dir readme](docs#readme) [top](#top)",
      "[gone](docs/missing.md) [anchor](docs/guide.md#nope) [case](#Getting-Started)",
      "[outside](../elsewhere.md) [nested readme](docs#install)",
    ].join("\n"),
    "docs/guide.md": "# Guide\n## Install\n",
  });
  assert.deepEqual(report.errors, [
    "README.md:4: links to docs/missing.md: docs/missing.md does not exist",
    "README.md:4: links to docs/guide.md#nope: docs/guide.md has no heading for #nope",
    "README.md:4: links to #Getting-Started: README.md has no heading for #Getting-Started (anchors are lowercase: #getting-started)",
    "README.md:5: links to ../elsewhere.md: it points outside the repository",
    "README.md:5: links to docs#install: docs has no README.md",
  ]);
  assert.equal(report.stats.links, 9);
});

test("an anchor on a folder resolves against its README", () => {
  const report = check({
    "README.md": "[a](docs#install) [b](docs/#missing)",
    "docs/README.md": "## Install",
  });
  assert.deepEqual(report.errors, [
    "README.md:1: links to docs/#missing: docs/README.md has no heading for #missing",
  ]);
});

test("changesets are skipped, the changeset README is not", () => {
  const report = check({
    ".changeset/README.md": "[x](gone.md)",
    ".changeset/brave-fox.md": "---\n'@zitadel/cli': patch\n---\n\n[x](gone.md)",
  });
  assert.deepEqual(report.errors, [
    ".changeset/README.md:1: links to gone.md: .changeset/gone.md does not exist",
  ]);
  assert.equal(report.stats.markdown, 1);
});

test("an allowed forward reference passes until it exists or nothing links to it", () => {
  const missingAllowed = new Map([
    ["docs/catalog.md", "not written yet"],
    ["internal/policy", "not written yet"],
  ]);
  const tree = { "docs/a.md": "[c](catalog.md) [p](../internal/policy/templates/)" };
  assert.deepEqual(check(tree, { missingAllowed }).errors, []);

  const written = check({ ...tree, "docs/catalog.md": "# Catalog" }, { missingAllowed });
  assert.deepEqual(written.errors, [
    "docs/catalog.md exists now; drop it from MISSING_ALLOWED in scripts/check-agent-docs.mjs (not written yet)",
  ]);

  const unlinked = check({ "docs/a.md": "[c](catalog.md)" }, { missingAllowed });
  assert.deepEqual(unlinked.errors, [
    "nothing links to internal/policy any more; drop it from MISSING_ALLOWED in scripts/check-agent-docs.mjs",
  ]);
});

test("citations resolve next to the citing file, at the root, or up the tree", () => {
  const report = check({
    "AGENTS.md": "# Root\n## Rules",
    "packages/components/AGENTS.md": "## Input atoms expose a real native control (agent-first)",
    "packages/components/src/zl-select.ts": [
      '// (see `packages/components/AGENTS.md` → "Input atoms expose a real native control")',
      "// nearest AGENTS.md#input-atoms-expose-a-real-native-control-agent-first",
      "// root AGENTS.md#rules is not the nearest one",
      '// `packages/components/AGENTS.md` → "Atoms are form-associated"',
      "// docs/missing.md#anything",
    ].join("\n"),
    "logo.png": "\u0089PNG\u0000",
  });
  assert.deepEqual(report.errors, [
    "packages/components/src/zl-select.ts:3: cites AGENTS.md#rules: packages/components/AGENTS.md has no heading for #rules",
    'packages/components/src/zl-select.ts:4: cites packages/components/AGENTS.md → "Atoms are form-associated": packages/components/AGENTS.md has no such heading',
    "packages/components/src/zl-select.ts:5: cites docs/missing.md#anything: neither packages/components/src/docs/missing.md nor docs/missing.md exists",
  ]);
  assert.equal(report.stats.citations, 5);
});

test("a section citation may run on into the sentence around it", () => {
  const report = check({
    "docs/validator.md": "## Runtime safety net",
    "src/gates.ts":
      "// Per `docs/validator.md` §Runtime safety net, after the parse.\n// `docs/validator.md` §Runtime\n// `docs/validator.md` §Safety",
  });
  assert.deepEqual(report.errors, [
    "src/gates.ts:3: cites docs/validator.md §Safety: docs/validator.md has no such heading",
  ]);
});

const agentsTree = (sizes) =>
  Object.fromEntries(Object.entries(sizes).map(([path, size]) => [path, "x".repeat(size)]));

test("each AGENTS.md and each chain of them has a budget", () => {
  const report = check(
    agentsTree({
      "AGENTS.md": BUDGETS.root + 1,
      "apps/AGENTS.md": BUDGETS.scoped,
      "apps/cli/AGENTS.md": BUDGETS.scoped + 1,
      "apps/cli/tests/AGENTS.md": BUDGETS.scoped,
    }),
  );
  assert.deepEqual(report.errors, [
    "AGENTS.md is 8,193 bytes, over the 8,192-byte budget; trim it",
    "apps/cli/AGENTS.md is 6,145 bytes, over the 6,144-byte budget; trim it",
    "apps/cli/tests/ reads AGENTS.md + apps/AGENTS.md + apps/cli/AGENTS.md + apps/cli/tests/AGENTS.md, which is 26,626 bytes, over the 24,576-byte budget; trim it",
  ]);
});

test("CRLF line endings count as LF", () => {
  const report = check({ "AGENTS.md": "x\r\n".repeat(BUDGETS.root / 2) });
  assert.deepEqual(report.errors, []);
});

test("the baseline holds an over-budget size exactly: growth, shrinkage and stale entries fail", () => {
  const tree = agentsTree({ "AGENTS.md": 9000, "docs/AGENTS.md": 100 });
  const baseline = { ...emptyBaseline(), oversized: { "AGENTS.md": 9000 } };
  assert.deepEqual(check(tree, { baseline }).errors, []);

  assert.deepEqual(check(agentsTree({ "AGENTS.md": 9001 }), { baseline }).errors, [
    "AGENTS.md is 9,001 bytes, over the 8,192-byte budget and up from the 9,000 bytes the baseline records; trim it back",
  ]);
  assert.deepEqual(check(agentsTree({ "AGENTS.md": 8999 }), { baseline }).errors, [
    "AGENTS.md is 8,999 bytes, over the 8,192-byte budget and down from the 9,000 bytes the baseline records; run `node scripts/check-agent-docs.mjs --update-baseline` to keep the trim",
  ]);
  assert.deepEqual(check(agentsTree({ "AGENTS.md": 8000 }), { baseline }).errors, [
    "AGENTS.md is in the baseline but not over budget any more; run `node scripts/check-agent-docs.mjs --update-baseline`",
  ]);
});

test("a CLAUDE.md fails unless the baseline lists it, and then only warns", () => {
  const tree = { "CLAUDE.md": "# Bootstrap", ".claude/CLAUDE.md": "# Local" };
  const baseline = { ...emptyBaseline(), claudeMd: ["CLAUDE.md"] };
  const report = check(tree, { baseline });
  assert.deepEqual(report.warnings, [
    "CLAUDE.md is tracked: while a CLAUDE.md exists, Claude Code never loads AGENTS.md; delete it",
  ]);
  assert.deepEqual(report.errors, [
    ".claude/CLAUDE.md is tracked: while a CLAUDE.md exists, Claude Code never loads AGENTS.md; delete it",
  ]);

  assert.deepEqual(check({}, { baseline }).errors, [
    "CLAUDE.md is in the baseline but gone; run `node scripts/check-agent-docs.mjs --update-baseline`",
  ]);
});

test("the next baseline may only shrink", () => {
  const measured = {
    oversized: { "b/AGENTS.md": 7000, "AGENTS.md": 9000 },
    oversizedChains: {},
    claudeMd: ["CLAUDE.md"],
  };
  const bootstrap = nextBaseline(null, measured);
  assert.deepEqual(bootstrap.refused, []);
  assert.equal(
    JSON.stringify(bootstrap.baseline),
    '{"oversized":{"AGENTS.md":9000,"b/AGENTS.md":7000},"oversizedChains":{},"claudeMd":["CLAUDE.md"]}',
  );

  const previous = {
    oversized: { "AGENTS.md": 8500, "c/AGENTS.md": 7000 },
    oversizedChains: {},
    claudeMd: [],
  };
  assert.deepEqual(nextBaseline(previous, measured).refused, [
    "b/AGENTS.md is over budget and not in the baseline",
    "AGENTS.md grew from 8,500 bytes to 9,000 bytes",
    "CLAUDE.md is a new CLAUDE.md",
  ]);
  assert.deepEqual(
    nextBaseline(previous, { oversized: { "AGENTS.md": 8400 }, oversizedChains: {}, claudeMd: [] }),
    {
      refused: [],
      baseline: { oversized: { "AGENTS.md": 8400 }, oversizedChains: {}, claudeMd: [] },
    },
  );
});
