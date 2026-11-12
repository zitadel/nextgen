# Console UI patterns

These seven guides describe **approved reusable UI/UX pattern targets** for the ZITADEL NextGen Console. They do not assert that all changes are implemented.

| Guide | Scope |
| --- | --- |
| [UI-01 — Tables & Resource Lists](01_Tables_and_Resource_Lists.md) | Tables, list anatomy, configurable columns and pagination |
| [UI-02 — Links & Actions](02_Links_and_Actions.md) | Links, navigation actions, copy and overflow |
| [UI-03 — Typography & Formatting](03_Typography_and_Formatting.md) | Type hierarchy, IDs, dates and metadata |
| [UI-04 — Detail Pages](04_Detail_Pages.md) | Detail page composition and hierarchy |
| [UI-05 — Visual Consistency](05_Visual_Consistency.md) | Tokens, cards, borders and visual treatment |
| [UI-06 — Feedback & States](06_Feedback_and_States.md) | Empty, error, loading, success and status states |
| [UI-07 — Forms & Dialogs](07_Forms_and_Dialogs.md) | Forms, validation, sheets and confirmations |

See the [approved design decisions and conflicts register](00_APPROVED_DESIGN_DECISIONS_AND_CONFLICTS.md) for the consolidated design handoff, conflicts and implementation checks. It is **not** an eighth pattern guide.

## Other sources of truth

- **Feature-specific UX/product decisions and rationale:** the [active historical decision log](../../decisions.md). This PR does not archive it.
- **Console routing and sidebar:** [Console ADR 0001](../../../../apps/console/docs/adrs/0001-console-routing.md); [team navigation ADR 0005](../../../../apps/console/docs/adrs/0005-team-navigation.md).
- **Product/backend semantics:** relevant accepted ADRs and feature specifications, e.g. [user lifecycle ADR 024](../../../adrs/024-user-team-lifecycle-ownership.md). [Search ADR 087](../../../adrs/087-search.md) is currently Proposed.
- **Implementation conventions:** the existing [Console styling baseline](../../../../apps/console/docs/styling.md). Preserve nonconflicting technical rules. A design-approved target is not evidence that implementation has been completed.

**Known ongoing reconciliation:** Historical D23 still differs from the approved Users Columns/identifier design. [PR #2817](https://github.com/zitadel/nextgen/pull/2817) proposes the implementation but is not merged; its proposed decision ID must be renumbered. See the register for the precise boundary.
