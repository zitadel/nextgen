# Console UI patterns

These seven guides expand the approved reusable UI/UX targets recorded in [D47](../../decisions.md), with the Users-specific D23 amendment in [D48](../../decisions.md). They do not assert that code has implemented the targets.

| Guide | Scope |
| --- | --- |
| [UI-01 — Tables & Resource Lists](01-tables-and-resource-lists.md) | Tables, list anatomy, configurable columns and pagination |
| [UI-02 — Links & Actions](02-links-and-actions.md) | Links, navigation actions, copy and overflow |
| [UI-03 — Typography & Formatting](03-typography-and-formatting.md) | Type hierarchy, IDs, dates and copy |
| [UI-04 — Detail Pages](04-detail-pages.md) | Detail page composition and hierarchy |
| [UI-05 — Visual Consistency](05-visual-consistency.md) | Tokens, cards, borders and visual treatment |
| [UI-06 — Feedback & States](06-feedback-and-states.md) | Empty, error, loading, success and status states |
| [UI-07 — Forms & Dialogs](07-forms-and-dialogs.md) | Forms, validation, sheets and confirmations |

See the [approved design decisions and conflicts register](00-approved-design-decisions-and-conflicts.md) for the consolidated design handoff, conflicts and implementation checks. It is **not** an eighth pattern guide.

## Authority, status and terminology

The active [design decisions log](../../decisions.md) records what was approved (D47/D48 and earlier D-decisions). These guides specify the reusable design targets and verification criteria; they do not create a second independent decision authority. [Console styling](../../../../apps/console/docs/styling.md) and the existing components document the **currently implemented technical baseline**. Where an approved target differs, the implementation PR must reconcile the code and update `styling.md` together. Nothing in this documentation-only PR changes implemented behavior.

Across the guides: **EXISTING** / **PRESERVE** = current behavior to retain; **APPROVED** = approved design target; **CHANGE** / **TECHNICAL CONFLICT** = approved difference requiring later implementation/reconciliation. Backend behavior, accessibility, responsive widths, navigation and permissions remain governed by their technical and product contracts unless explicitly amended.

## Other sources of truth

- **Feature-specific UX/product decisions and rationale:** the active [design decisions log](../../decisions.md); routing and feature decisions remain authoritative for their respective scopes.
- **Console routing and sidebar:** [Console ADR 0001](../../../../apps/console/docs/adrs/0001-console-routing.md); [team navigation ADR 0005](../../../../apps/console/docs/adrs/0005-team-navigation.md).
- **Product/backend semantics:** relevant accepted ADRs and feature specifications, e.g. [user lifecycle ADR 024](../../../adrs/024-user-team-lifecycle-ownership.md). See also [Search ADR 087](../../../adrs/087-search.md).
- **Implementation conventions:** the existing [Console styling baseline](../../../../apps/console/docs/styling.md). Preserve nonconflicting technical rules. A design-approved target is not evidence that implementation has been completed.

**Implementation follow-up:** D48 supersedes only the specified Users-table provisions of D23. The actual Console implementation and any in-flight code changes must be aligned in their own PRs; see the register for the remaining baseline conflicts.
