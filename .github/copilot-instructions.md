# Repository Review Instructions

Zitadel nextgen is pre-release. Review for correctness and contract stability
more than polish.

**These files only point. The rules live in [`AGENTS.md`](../AGENTS.md) and the
nearest scoped `AGENTS.md` for the touched path** — read those first; the files
under `.github/instructions/` add per-area review heuristics, not parallel
rules.

- Validation commands:
  [`AGENTS.md` — Workflow Front Doors](../AGENTS.md#workflow-front-doors).
- Never ask an author to hand-edit generated output
  ([`AGENTS.md` — Hard rules](../AGENTS.md#hard-rules)).
- CLI changes: the agent contract is
  [`apps/cli/skills/zitadel-cli/SKILL.md`](../apps/cli/skills/zitadel-cli/SKILL.md);
  package rules are in [`apps/cli/AGENTS.md`](../apps/cli/AGENTS.md).
- The claim lifecycle is shipped
  ([ADR 046](../docs/adrs/046-claim-lifecycle-v2.md)): review claim changes
  against it, and do not ask for its removal.
- Flag project or preview tokens, keys and `.zitadel/secret`-style values in
  source control or in browser-visible env metadata.
- Changesets and PR titles: the
  [decision table](../.changeset/README.md#decision-table) and
  [`CONTRIBUTING.md#title-format`](../CONTRIBUTING.md#title-format) are
  canonical. Challenge the title type in both directions — it decides what
  reaches customer release notes.
- Versions: flag a Node major bump that misses a pin, an exact dependency pin
  without a comment saying why, and a dependency shared by several packages
  that is not a `catalog:` entry. Do not ask for exact-version matches
  ([rules](../CONTRIBUTING.md#nodejs-and-dependency-versions)).
- Licensing split: [`LICENSING.md`](../LICENSING.md).
- Journey-gate changes (`e2e/journey/**`, `ci.yml` journey steps):
  [`e2e/journey/AGENTS.md`](../e2e/journey/AGENTS.md) is canonical.
- Local runtime command changes:
  [`apps/cli/src/lib/local-server/AGENTS.md`](../apps/cli/src/lib/local-server/AGENTS.md)
  is canonical; the zero-config paths agents rely on are in
  [`SKILL.md`](../apps/cli/skills/zitadel-cli/SKILL.md).
